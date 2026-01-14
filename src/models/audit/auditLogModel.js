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
    },
    resource: {
        type: String,
        required: true,
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
    },
});




const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;
