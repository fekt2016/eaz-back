const mongoose = require('mongoose');

/**
 * Support Message Model
 * Messages/replies within a support ticket
 */
const supportMessageSchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportTicket',
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'senderModel',
      required: true,
    },
    senderModel: {
      type: String,
      required: true,
      enum: ['User', 'Seller', 'Admin'],
    },
    senderRole: {
      type: String,
      required: true,
      enum: ['buyer', 'seller', 'admin', 'system'],
    },
    senderName: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    attachments: [
      {
        url: String,
        filename: String,
        mimetype: String,
        size: Number,
      },
    ],
    isInternal: {
      type: Boolean,
      default: false,
      comment: 'Internal notes visible only to admins',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);




const SupportMessage = mongoose.model('SupportMessage', supportMessageSchema);

module.exports = SupportMessage;

