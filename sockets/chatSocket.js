const jwt = require('jsonwebtoken')
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

        // Handle Conversation Messages (Rooms Mode)
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

                // Update latest message reference in Conversation document
                await Conversation.findByIdAndUpdate(conversationId, {
                    latestMessage: newMsg._id
                });

                const msgPayload = {
                    _id: newMsg._id,
                    conversationId: conversationId,
                    sender: username,
                    senderId: userId,
                    message: newMsg.message,
                    createdAt: newMsg.createdAt
                };

                // Broadcast to all other sockets in this room
                socket.to(conversationId).emit('receive-conversation-message', msgPayload);

            } catch (err) {
                console.error('Error saving or broadcasting conversation message:', err);
            }
        });

        // Handle Legacy Group Message
        socket.on('message', async (data) => {
            try {
                const newMsg = await Message.create({
                    sender: username,
                    senderId: userId,
                    message: data.message,
                    isPrivate: false
                })

                socket.broadcast.emit('chat-message', {
                    _id: newMsg._id,
                    sender: username,
                    senderId: userId,
                    message: newMsg.message,
                    createdAt: newMsg.createdAt,
                    isPrivate: false
                })
            } catch (err) {
                console.error('Group message error:', err)
            }
        })

        // Handle Legacy Direct Message (DM)
        socket.on('private-message', async ({ targetUserId, message }) => {
            try {
                const newMsg = await Message.create({
                    sender: username,
                    senderId: userId,
                    recipientId: targetUserId,
                    message: message,
                    isPrivate: true
                })

                const msgData = {
                    _id: newMsg._id,
                    sender: username,
                    senderId: userId,
                    recipientId: targetUserId,
                    message: newMsg.message,
                    createdAt: newMsg.createdAt,
                    isPrivate: true
                }

                // Send to recipient sockets
                const targetSockets = connectedUsers[targetUserId]?.sockets || []
                targetSockets.forEach(socketId => {
                    io.to(socketId).emit('private-message', msgData)
                })

                // Send back to sender sockets
                const senderSockets = connectedUsers[userId]?.sockets || []
                senderSockets.forEach(socketId => {
                    io.to(socketId).emit('private-message', msgData)
                })

            } catch (err) {
                console.error('Private message error:', err)
            }
        })

        // Handle Disconnect
        socket.on('disconnect', () => {
            if (connectedUsers[userId]) {
                connectedUsers[userId].sockets = connectedUsers[userId].sockets.filter(id => id !== socket.id)
                if (connectedUsers[userId].sockets.length === 0) {
                    delete connectedUsers[userId]
                }
            }
            broadcastUserList()
            io.emit('clients-total', io.engine.clientsCount)
        })
    })
}