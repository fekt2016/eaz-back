const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'userModel',
    },
    userModel: {
        type: String,
        enum: ['User', 'Seller', 'Admin'],
        default: 'User',
    },
    action: {
        type: String,
        required: true,
        index: true,
    },
    resource: {
        type: String,
        required: true,
        index: true,
    },
    resourceId: {
        type: mongoose.Schema.Types.ObjectId,
    },
    changes: {
        type: mongoose.Schema.Types.Mixed,
    },
    ipAddress: String,
    userAgent: String,
    status: {
        type: String,
        enum: ['success', 'failure'],
        default: 'success',
    },
    errorMessage: String,
    metadata: mongoose.Schema.Types.Mixed,
    timestamp: {
        type: Date,
        default: Date.now,
        index: true,
    },
});

// Index for efficient querying
auditLogSchema.index({ user: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ resource: 1, resourceId: 1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
