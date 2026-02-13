const mongoose = require('mongoose');

/**
 * Admin Audit Log Model
 * Tracks all changes to platform settings for audit purposes
 */
const adminAuditLogSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true,
  },
  actionType: {
    type: String,
    enum: [
      'TAX_UPDATE',
      'COMMISSION_UPDATE',
      'WITHHOLDING_UPDATE',
      'SETTINGS_UPDATE',
      'INTERNATIONAL_SHIPPING_UPDATE',
    ],
    required: true,
    index: true,
  },
  fieldUpdated: {
    type: String,
    required: true,
    comment: 'Name of the field that was updated (e.g., vatRate, platformCommissionRate)',
  },
  beforeValue: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    comment: 'Value before the update',
  },
  afterValue: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    comment: 'Value after the update',
  },
  description: {
    type: String,
    default: '',
    comment: 'Optional description of the change',
  },
  metadata: {
    type: Object,
    default: {},
    comment: 'Additional metadata about the change',
  },
}, {
  timestamps: true,
});




const AdminAuditLog = mongoose.model('AdminAuditLog', adminAuditLogSchema);

module.exports = AdminAuditLog;

