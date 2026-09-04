const jwt = require('jsonwebtoken')
const mongoose = require('mongoose')
const Message = require('../models/Message')
const Conversation = require('../models/conversation')

const JWT_SECRET = process.env.JWT_SECRET || 'secretkey'
let connectedUsers = {}

module.exports = (io) => {
    // Middleware for JWT authentication
    io.use((socket, next) => {
        const token = socket.handshake.auth.token
        if (!token) return next(new Error('Authentication error: Token missing'))
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) return next(new Error('Authentication error: Invalid token'))
            socket.user = decoded
            next()
        })
    })

    io.on('connection', (socket) => {
        const userId = socket.user.id || socket.user._id
        const username = socket.user.username

        // Track connected user socket sessions
        if (!connectedUsers[userId]) {
            connectedUsers[userId] = { username, sockets: [socket.id] }
        } else {
            connectedUsers[userId].sockets.push(socket.id)
        }

        const broadcastUserList = () => {
            const userList = Object.entries(connectedUsers).map(([id, u]) => ({
                userId: id,
                username: u.username
            }))
            io.emit('user-list', userList)
        }

        broadcastUserList()
        io.emit('clients-total', io.engine.clientsCount)

        // 1. Join a Conversation Room
        socket.on('join-conversation', (conversationId) => {
            if (conversationId) {
                socket.join(conversationId)
            }
        })

        // Handle Messages (Group & DM Rooms)
        socket.on('send-conversation-message', async (data) => {
            try {
                const { conversationId, message } = data;

                if (!conversationId) {
                    console.error("Missing conversationId in payload:", data);
                    return;
                }

                // Save message to DB
                const newMsg = await Message.create({
                    conversationId: conversationId,
                    sender: username,
                    senderId: userId,
                    message: message
                });

                // Update Conversation document if it's a valid MongoDB ObjectId
                if (conversationId !== 'group' && mongoose.Types.ObjectId.isValid(conversationId)) {
                    await Conversation.findByIdAndUpdate(conversationId, {
                        latestMessage: newMsg._id
                    });
                }

                const msgPayload = {
                    _id: newMsg._id,
                    conversationId: conversationId,
                    sender: username,
                    senderId: userId,
                    message: newMsg.message,
                    createdAt: newMsg.createdAt
                };

                if (conversationId !== 'group' && mongoose.Types.ObjectId.isValid(conversationId)) {
                    const conversation = await Conversation.findById(conversationId).select('users');
                    const recipientSocketIds = (conversation?.users || [])
                        .flatMap(id => connectedUsers[String(id)]?.sockets || []);

                    [...new Set(recipientSocketIds)].forEach(socketId => {
                        io.to(socketId).emit('receive-conversation-message', msgPayload);
                    });
                } else {
                    io.to(conversationId).emit('receive-conversation-message', msgPayload);
                }

            } catch (err) {
                console.error('Error saving or broadcasting conversation message:', err);
            }
        });

        // Handle Direct Messages (Fallback/Direct Routing)
        socket.on('private-message', async ({ targetUserId, message, conversationId }) => {
            try {
                const targetId = conversationId || targetUserId;

                const newMsg = await Message.create({
                    conversationId: targetId,
                    sender: username,
                    senderId: userId,
                    recipientId: targetUserId,
                    message: message,
                    isPrivate: true
                });

                const msgData = {
                    _id: newMsg._id,
                    conversationId: targetId,
                    sender: username,
                    senderId: userId,
                    recipientId: targetUserId,
                    message: newMsg.message,
                    createdAt: newMsg.createdAt,
                    isPrivate: true
                };

                // Send to recipient's active socket connections
                const targetSockets = connectedUsers[targetUserId]?.sockets || [];
                targetSockets.forEach(socketId => {
                    io.to(socketId).emit('receive-conversation-message', msgData);
                });

                // Send back to sender's active socket connections
                const senderSockets = connectedUsers[userId]?.sockets || [];
                senderSockets.forEach(socketId => {
                    io.to(socketId).emit('receive-conversation-message', msgData);
                });

            } catch (err) {
                console.error('Private message error:', err);
            }
        });

        // Handle Disconnect
        socket.on('disconnect', () => {
            if (connectedUsers[userId]) {
                connectedUsers[userId].sockets = connectedUsers[userId].sockets.filter(id => id !== socket.id);
                if (connectedUsers[userId].sockets.length === 0) {
                    delete connectedUsers[userId];
                }
            }
            broadcastUserList();
            io.emit('clients-total', io.engine.clientsCount);
        });
    });
};