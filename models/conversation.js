const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  name: {
    type: String,
    default: 'Chat'
  },
  users: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // 👈 Change 'UserModel' to 'User'
  }],
  latestMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // 👈 Change 'UserModel' to 'User' here too if present
  }
}, { timestamps: true });

module.exports = mongoose.model('Conversation', conversationSchema);