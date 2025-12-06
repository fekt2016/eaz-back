const mongoose = require('mongoose');

/**
 * SECURITY FIX #16: Audit Logging Service
 * Comprehensive audit trail for critical operations
 */

const AuditLog = require('../models/audit/auditLogModel');

/**
 * Create an audit log entry
 */
exports.logAudit = async ({
    userId,
    userModel = 'User', // User, Seller, or Admin
    action,
    resource,
    resourceId,
    changes = {},
    ipAddress,
    userAgent,
    status = 'success',
    errorMessage,
    metadata = {},
}) => {
    try {
        await AuditLog.create({
            user: userId ? new mongoose.Types.ObjectId(userId) : null,
            userModel,
            action,
            resource,
            resourceId: resourceId ? new mongoose.Types.ObjectId(resourceId) : null,
            changes,
            ipAddress,
            userAgent,
            status,
            errorMessage,
            metadata,
            timestamp: new Date(),
        });
    } catch (error) {
        // Don't fail the operation if audit logging fails
        console.error('[AuditLog] Failed to create audit log:', error);
    }
};

/**
 * Log wallet operations
 */
exports.logWalletOperation = async (req, operation, amount, balanceBefore, balanceAfter) => {
    return exports.logAudit({
        userId: req.user?.id,
        userModel: req.user?.role === 'seller' ? 'Seller' : 'User',
        action: `WALLET_${operation.toUpperCase()}`,
        resource: 'Wallet',
        changes: {
            operation,
            amount,
            balanceBefore,
            balanceAfter,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
    });
};

/**
 * Log payment operations
 */
exports.logPaymentOperation = async (req, action, orderId, amount, status) => {
    return exports.logAudit({
        userId: req.user?.id,
        action: `PAYMENT_${action.toUpperCase()}`,
        resource: 'Payment',
        resourceId: orderId,
        changes: {
            amount,
            status,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status,
    });
};

/**
 * Log withdrawal operations
 */
exports.logWithdrawalOperation = async (req, action, requestId, amount, status) => {
    return exports.logAudit({
        userId: req.user?.id,
        userModel: 'Seller',
        action: `WITHDRAWAL_${action.toUpperCase()}`,
        resource: 'PaymentRequest',
        resourceId: requestId,
        changes: {
            amount,
            status,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status,
    });
};

/**
 * Log password reset operations
 */
exports.logPasswordReset = async (req, userId, success) => {
    return exports.logAudit({
        userId,
        action: 'PASSWORD_RESET',
        resource: 'User',
        resourceId: userId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: success ? 'success' : 'failure',
    });
};

/**
 * Log login attempts
 */
exports.logLoginAttempt = async (req, userId, success, reason) => {
    return exports.logAudit({
        userId,
        action: 'LOGIN',
        resource: 'Auth',
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        status: success ? 'success' : 'failure',
        errorMessage: reason,
    });
};
