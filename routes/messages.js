const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Message = require('../models/Message');

const JWT_SECRET = process.env.JWT_SECRET || 'secretkey';

// Fetch conversation message history
router.get('/filtered', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const targetId = req.query.targetUserId;

        let filter = {};

        if (!targetId || targetId === 'all' || targetId === 'group') {
            // Group / Public chat filter
            filter = {
                isPrivate: false,
                $or: [
                    { conversationId: 'group' },
                    { conversationId: { $exists: false } }
                ]
            };
        } else {
            // Find messages by conversationId or direct fallback match
            const conversationIds = [targetId];
            if (mongoose.Types.ObjectId.isValid(targetId)) {
                conversationIds.push(new mongoose.Types.ObjectId(targetId));
            }

            filter = {
                $or: [
                    { conversationId: { $in: conversationIds } },
                    { senderId: decoded.id, recipientId: targetId },
                    { senderId: targetId, recipientId: decoded.id }
                ]
            };
        }

        const messages = await Message.find(filter).sort({ createdAt: 1 }).limit(100);
        res.json(messages);
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
});

module.exports = router;