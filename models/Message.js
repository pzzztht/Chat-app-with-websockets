const mongoose = require('mongoose')

const messageSchema = new mongoose.Schema({
    conversationId: {
        type: mongoose.Schema.Types.Mixed,
        ref: 'Conversation'
    },
    sender: {
        type: String,
        required: true
    },
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    recipientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    message: {
        type: String,
        required: true
    },
    isPrivate: {
        type: Boolean,
        default: false
    }
}, { timestamps: true })

module.exports = mongoose.model('Message', messageSchema)