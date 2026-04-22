const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatConversation',
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'senderModel',
    },
    senderModel: {
      type: String,
      required: true,
      enum: ['User', 'Seller', 'Admin', 'Guest'],
    },
    senderRole: {
      type: String,
      required: true,
      enum: ['buyer', 'seller', 'admin', 'guest'],
    },
    senderName: { type: String, required: true },
    content: {
      type: String,
      required: true,
      maxlength: 2000,
      trim: true,
    },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

chatMessageSchema.index({ conversationId: 1, createdAt: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
