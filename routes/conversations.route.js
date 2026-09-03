const express = require('express');
const router = express.Router();
const Conversation = require('../models/conversation');
require('../models/User'); // 👈 Add this line so Mongoose registers the User schema

// POST /api/conversations
router.post('/', async (req, res) => {
  try {
    let { name, users, targetUserId, senderId } = req.body;

    if (!users && senderId && targetUserId) {
      users = [senderId, targetUserId];
    }

    if (!users || !Array.isArray(users) || users.length < 2) {
      return res.status(400).json({ error: "At least two user ObjectIds are required." });
    }

    let conversation = await Conversation.findOne({
      users: { $all: users, $size: users.length }
    })
    .populate('users', 'username avatar')
    .populate('latestMessage');

    if (conversation) {
      return res.json(conversation);
    }

    conversation = await Conversation.create({
      name: name || "Chat",
      users: users,
      admin: users[0]
    });

    const populatedConversation = await Conversation.findById(conversation._id)
      .populate('users', 'username avatar');

    return res.status(201).json(populatedConversation);
  } catch (err) {
    console.error("Conversation creation error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/:userId
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const conversations = await Conversation.find({
      users: { $in: [userId] }
    })
    .populate('users', 'username avatar')
    .populate('latestMessage') // 👈 Populates latest message details
    .sort({ updatedAt: -1 });

    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;