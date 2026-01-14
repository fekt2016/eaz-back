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
    enum: ['WITHDRAWAL_APPROVED', 'WITHDRAWAL_REJECTED', 'PAYOUT_VERIFICATION_APPROVED', 'PAYOUT_VERIFICATION_REJECTED'],
    required: true,
    index: true,
  },
  withdrawalId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false, // Not required for payout verification actions
    index: true,
    comment: 'Reference to PaymentRequest or WithdrawalRequest (null for payout verification)',
  },
  withdrawalType: {
    type: String,
    enum: ['PaymentRequest', 'WithdrawalRequest'],
    required: false, // Not required for payout verification actions
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Seller',
    required: true,
    index: true,
  },
  oldStatus: {
    type: String,
    required: false,
    comment: 'Previous payout status (for payout verification actions)',
  },
  newStatus: {
    type: String,
    required: false,
    comment: 'New payout status (for payout verification actions)',
  },
  amountRequested: {
    type: Number,
    required: false, // Not required for payout verification actions
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

