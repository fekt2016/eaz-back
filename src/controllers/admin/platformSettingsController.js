/**
 * Platform Settings Controller
 * Handles GET and PATCH operations for platform settings
 */

const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const PlatformSettings = require('../../models/platform/platformSettingsModel');
const AdminAuditLog = require('../../models/platform/adminAuditLogModel');

/**
 * Get platform settings
 * GET /api/v1/admin/settings/platform
 */
exports.getPlatformSettings = catchAsync(async (req, res, next) => {
  const settings = await PlatformSettings.getSettings();

  res.status(200).json({
    status: 'success',
    data: {
      settings,
    },
  });
});

/**
 * Normalize a rate to decimal (0-1). If stored as percentage (e.g. 15), convert to 0.15.
 */
function toDecimalRate(value, defaultRate) {
  const n = value != null ? Number(value) : defaultRate;
  if (Number.isNaN(n)) return defaultRate;
  return n > 1 ? n / 100 : n;
}

/**
 * Get tax rates for buyer checkout.
 * Returns the same VAT, NHIL and GETFund values as the Platform Settings table (admin).
 * Checkout must use these values to calculate tax – single source of truth.
 * GET /api/v1/order/tax-rates
 */
exports.getTaxRates = catchAsync(async (req, res, next) => {
  const settings = await PlatformSettings.getSettings();
  // Return actual stored values (no defaults that override saved 15% etc.)
  const vatRate = settings.vatRate != null ? toDecimalRate(settings.vatRate, 0.125) : 0.125;
  const nhilRate = settings.nhilRate != null ? toDecimalRate(settings.nhilRate, 0.025) : 0.025;
  const getfundRate = settings.getfundRate != null ? toDecimalRate(settings.getfundRate, 0.025) : 0.025;

  res.status(200).json({
    status: 'success',
    data: {
      taxRates: {
        vatRate,
        nhilRate,
        getfundRate,
      },
    },
  });
});

/**
 * Update platform settings
 * PATCH /api/v1/admin/settings/platform
 * Body: { vatRate, nhilRate, getfundRate, platformCommissionRate }
 */
exports.updatePlatformSettings = catchAsync(async (req, res, next) => {
  const adminId = req.user.id;
  const updates = req.body;

  // Get current settings to compare
  const currentSettings = await PlatformSettings.getSettings();

  // Validate that at least one field is being updated
  const allowedFields = [
    'vatRate',
    'nhilRate',
    'getfundRate',
    'platformCommissionRate',
  ];

  const fieldsToUpdate = {};
  const auditLogs = [];

  // Validate and prepare updates
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      const newValue = parseFloat(updates[field]);
      
      // Validate range (0 to 1 for percentages)
      if (isNaN(newValue) || newValue < 0 || newValue > 1) {
        return next(new AppError(`Invalid value for ${field}. Must be between 0 and 1.`, 400));
      }

      const oldValue = currentSettings[field];
      
      // Only update if value has changed
      if (oldValue !== newValue) {
        fieldsToUpdate[field] = newValue;

        // Determine action type
        let actionType = 'SETTINGS_UPDATE';
        if (field.includes('vat') || field.includes('nhil') || field.includes('getfund')) {
          actionType = 'TAX_UPDATE';
        } else if (field.includes('commission')) {
          actionType = 'COMMISSION_UPDATE';
        }

        // Create audit log entry
        auditLogs.push({
          adminId,
          actionType,
          fieldUpdated: field,
          beforeValue: oldValue,
          afterValue: newValue,
          description: `Updated ${field} from ${(oldValue * 100).toFixed(2)}% to ${(newValue * 100).toFixed(2)}%`,
          metadata: {
            oldPercentage: oldValue * 100,
            newPercentage: newValue * 100,
          },
        });
      }
    }
  }

  // Check if there are any changes
  if (Object.keys(fieldsToUpdate).length === 0) {
    return res.status(200).json({
      status: 'success',
      message: 'No changes detected',
      data: {
        settings: currentSettings,
      },
    });
  }

  // Update settings
  const updatedSettings = await PlatformSettings.updateSettings(fieldsToUpdate);
  
  // Clear tax service cache to ensure new rates are used immediately
  const taxService = require('../../services/tax/taxService');
  taxService.clearSettingsCache();

  // Create audit log entries
  if (auditLogs.length > 0) {
    await AdminAuditLog.insertMany(auditLogs);
  }

  // Log activity
  const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
  logActivityAsync({
    userId: adminId,
    role: 'admin',
    action: 'UPDATE_PLATFORM_SETTINGS',
    description: `Admin updated platform settings: ${Object.keys(fieldsToUpdate).join(', ')}`,
    req,
    metadata: {
      fieldsUpdated: Object.keys(fieldsToUpdate),
      changes: fieldsToUpdate,
    },
  });

  res.status(200).json({
    status: 'success',
    message: 'Platform settings updated successfully',
    data: {
      settings: updatedSettings,
      changes: fieldsToUpdate,
      auditLogsCreated: auditLogs.length,
    },
  });
});

/**
 * Get audit logs for platform settings
 * GET /api/v1/admin/settings/audit-logs
 * Query params: page, limit, actionType, fieldUpdated
 */
exports.getAuditLogs = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 50, actionType, fieldUpdated } = req.query;

  const query = {};

  if (actionType) {
    query.actionType = actionType;
  }

  if (fieldUpdated) {
    query.fieldUpdated = fieldUpdated;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [logs, total] = await Promise.all([
    AdminAuditLog.find(query)
      .populate('adminId', 'name email')
      .sort('-createdAt')
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
    AdminAuditLog.countDocuments(query),
  ]);

  const totalPages = Math.ceil(total / parseInt(limit));

  res.status(200).json({
    status: 'success',
    results: logs.length,
    pagination: {
      currentPage: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages,
    },
    data: {
      auditLogs: logs,
    },
  });
});

