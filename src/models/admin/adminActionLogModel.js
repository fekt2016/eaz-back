const mongoose = require('mongoose');

/**
 * Admin Action Log Model
 * Tracks all admin actions on withdrawal requests for audit purposes
 * Logs are NEVER deleted, even if withdrawal is deleted
 */
const adminActionLogSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    required: true,
    enum: ['superadmin', 'admin', 'moderator'],
    index: true,
  },
  actionType: {
    type: String,
    enum: ['WITHDRAWAL_APPROVED', 'WITHDRAWAL_REJECTED'],
    required: true,
    index: true,
  },
  withdrawalId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true,
    comment: 'Reference to PaymentRequest or WithdrawalRequest',
  },
  withdrawalType: {
    type: String,
    enum: ['PaymentRequest', 'WithdrawalRequest'],
    required: true,
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Seller',
    required: true,
    index: true,
  },
  amountRequested: {
    type: Number,
    required: true,
    min: 0,
  },
  amountPaid: {
    type: Number,
    default: 0,
    min: 0,
    comment: 'Amount paid to seller (after withholding tax)',
  },
  withholdingTax: {
    type: Number,
    default: 0,
    min: 0,
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
  ipAddress: {
    type: String,
    default: null,
  },
  userAgent: {
    type: String,
    default: null,
  },
  rejectionReason: {
    type: String,
    default: null,
    comment: 'Reason for rejection (if actionType is WITHDRAWAL_REJECTED)',
  },
  metadata: {
    type: Object,
    default: {},
    comment: 'Additional metadata about the action',
  },
}, {
  timestamps: true,
});




const AdminActionLog = mongoose.model('AdminActionLog', adminActionLogSchema);

module.exports = AdminActionLog;

