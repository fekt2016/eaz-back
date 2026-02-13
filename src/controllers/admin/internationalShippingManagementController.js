const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const InternationalShippingConfig = require('../../models/shipping/internationalShippingConfigModel');
const ImportDutyByCategory = require('../../models/shipping/importDutyByCategoryModel');
const Order = require('../../models/order/orderModel');
const AdminAuditLog = require('../../models/platform/adminAuditLogModel');

/**
 * Validate no overlapping weight ranges
 */
function validateWeightRanges(weightRanges) {
  if (!Array.isArray(weightRanges) || weightRanges.length === 0) {
    return { valid: true };
  }
  const sorted = [...weightRanges].sort((a, b) => a.minWeight - b.minWeight);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].minWeight < sorted[i - 1].maxWeight) {
      return { valid: false, message: 'Weight ranges must not overlap' };
    }
  }
  return { valid: true };
}

/**
 * Check if country config has active orders (preorder_international, not delivered/cancelled)
 */
async function hasActiveOrdersForCountry(country) {
  const count = await Order.countDocuments({
    orderType: 'preorder_international',
    supplierCountry: country,
    currentStatus: { $nin: ['delivered', 'cancelled', 'refunded'] },
  });
  return count > 0;
}

/**
 * Log admin action for audit trail
 */
async function logConfigChange(adminId, actionType, fieldUpdated, beforeValue, afterValue, description) {
  try {
    await AdminAuditLog.create({
      adminId,
      actionType,
      fieldUpdated,
      beforeValue,
      afterValue,
      description,
      metadata: {},
    });
  } catch (err) {
    // Don't fail the request if audit log fails
  }
}

// ==================== InternationalShippingConfig ====================

exports.getInternationalShippingConfigs = catchAsync(async (req, res) => {
  const configs = await InternationalShippingConfig.find({}).sort({ country: 1 }).lean();
  res.status(200).json({
    status: 'success',
    data: { configs },
  });
});

exports.getInternationalShippingConfigByCountry = catchAsync(async (req, res, next) => {
  const country = req.params.country;
  const normalized = String(country || '').trim();
  const c = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
  if (c !== 'China' && c !== 'USA') {
    return next(new AppError('Invalid country. Must be China or USA.', 400));
  }
  const config = await InternationalShippingConfig.findOne({ country: c }).lean();
  if (!config) {
    return next(new AppError('Config not found for this country.', 404));
  }
  res.status(200).json({
    status: 'success',
    data: { config },
  });
});

exports.createInternationalShippingConfig = catchAsync(async (req, res, next) => {
  const { country, weightRanges, defaultImportDutyRate, clearingFee, localDeliveryFee, customsBufferPercent, isActive } = req.body;

  const normalized = String(country || '').trim();
  const c = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
  if (c !== 'China' && c !== 'USA') {
    return next(new AppError('Invalid country. Must be China or USA.', 400));
  }

  const existing = await InternationalShippingConfig.findOne({ country: c });
  if (existing) {
    return next(new AppError('Config already exists for this country. Use update instead.', 400));
  }

  const validation = validateWeightRanges(weightRanges || []);
  if (!validation.valid) {
    return next(new AppError(validation.message, 400));
  }

  const config = await InternationalShippingConfig.create({
    country: c,
    weightRanges: weightRanges || [],
    defaultImportDutyRate: Number(defaultImportDutyRate) ?? 0.3,
    clearingFee: Number(clearingFee) || 0,
    localDeliveryFee: Number(localDeliveryFee) || 0,
    customsBufferPercent: Number(customsBufferPercent) ?? 5,
    isActive: isActive !== false,
    createdBy: req.user?._id,
    updatedBy: req.user?._id,
  });

  await logConfigChange(
    req.user?._id,
    'INTERNATIONAL_SHIPPING_UPDATE',
    'internationalShippingConfig',
    null,
    config.toObject(),
    `Created config for ${c}`
  );

  res.status(201).json({
    status: 'success',
    data: { config },
  });
});

exports.updateInternationalShippingConfig = catchAsync(async (req, res, next) => {
  const country = req.params.country;
  const normalized = String(country || '').trim();
  const c = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
  if (c !== 'China' && c !== 'USA') {
    return next(new AppError('Invalid country. Must be China or USA.', 400));
  }

  const config = await InternationalShippingConfig.findOne({ country: c });
  if (!config) {
    return next(new AppError('Config not found for this country.', 404));
  }

  const { weightRanges, defaultImportDutyRate, clearingFee, localDeliveryFee, customsBufferPercent, isActive } = req.body;

  if (weightRanges !== undefined) {
    const validation = validateWeightRanges(weightRanges);
    if (!validation.valid) {
      return next(new AppError(validation.message, 400));
    }
  }

  const before = config.toObject();

  if (weightRanges !== undefined) config.weightRanges = weightRanges;
  if (defaultImportDutyRate !== undefined) config.defaultImportDutyRate = Number(defaultImportDutyRate);
  if (clearingFee !== undefined) config.clearingFee = Number(clearingFee);
  if (localDeliveryFee !== undefined) config.localDeliveryFee = Number(localDeliveryFee);
  if (customsBufferPercent !== undefined) config.customsBufferPercent = Number(customsBufferPercent);
  if (isActive !== undefined) config.isActive = Boolean(isActive);

  config.updatedBy = req.user?._id;
  await config.save({ validateBeforeSave: true });

  await logConfigChange(
    req.user?._id,
    'INTERNATIONAL_SHIPPING_UPDATE',
    'internationalShippingConfig',
    before,
    config.toObject(),
    `Updated config for ${c}`
  );

  res.status(200).json({
    status: 'success',
    data: { config },
  });
});

exports.deleteInternationalShippingConfig = catchAsync(async (req, res, next) => {
  const country = req.params.country;
  const normalized = String(country || '').trim();
  const c = normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
  if (c !== 'China' && c !== 'USA') {
    return next(new AppError('Invalid country. Must be China or USA.', 400));
  }

  const hasActive = await hasActiveOrdersForCountry(c);
  if (hasActive) {
    return next(new AppError('Cannot delete config: active international pre-orders exist for this country.', 400));
  }

  const config = await InternationalShippingConfig.findOneAndDelete({ country: c });
  if (!config) {
    return next(new AppError('Config not found for this country.', 404));
  }

  await logConfigChange(
    req.user?._id,
    'INTERNATIONAL_SHIPPING_UPDATE',
    'internationalShippingConfig',
    config.toObject(),
    null,
    `Deleted config for ${c}`
  );

  res.status(200).json({
    status: 'success',
    data: null,
    message: 'Config deleted',
  });
});

// ==================== ImportDutyByCategory ====================

exports.getImportDutyByCategory = catchAsync(async (req, res) => {
  const rates = await ImportDutyByCategory.find({}).sort({ category: 1 }).lean();
  res.status(200).json({
    status: 'success',
    data: { rates },
  });
});

exports.createImportDutyByCategory = catchAsync(async (req, res, next) => {
  const { category, dutyRate } = req.body;
  if (!category || category.trim() === '') {
    return next(new AppError('Category is required.', 400));
  }
  const key = String(category).trim().toLowerCase();
  const rate = Number(dutyRate);
  if (isNaN(rate) || rate < 0 || rate > 1) {
    return next(new AppError('Duty rate must be between 0 and 1 (e.g. 0.3 for 30%).', 400));
  }

  const existing = await ImportDutyByCategory.findOne({ category: key });
  if (existing) {
    return next(new AppError('Category already exists. Use update instead.', 400));
  }

  const doc = await ImportDutyByCategory.create({
    category: key,
    dutyRate: rate,
    createdBy: req.user?._id,
    updatedBy: req.user?._id,
  });

  await logConfigChange(
    req.user?._id,
    'INTERNATIONAL_SHIPPING_UPDATE',
    'importDutyByCategory',
    null,
    doc.toObject(),
    `Added duty rate for category: ${key}`
  );

  res.status(201).json({
    status: 'success',
    data: { rate: doc },
  });
});

exports.updateImportDutyByCategory = catchAsync(async (req, res, next) => {
  const id = req.params.id;
  const { dutyRate } = req.body;
  const rate = Number(dutyRate);
  if (isNaN(rate) || rate < 0 || rate > 1) {
    return next(new AppError('Duty rate must be between 0 and 1 (e.g. 0.3 for 30%).', 400));
  }

  const doc = await ImportDutyByCategory.findById(id);
  if (!doc) {
    return next(new AppError('Category duty not found.', 404));
  }

  const before = doc.toObject();
  doc.dutyRate = rate;
  doc.updatedBy = req.user?._id;
  await doc.save();

  await logConfigChange(
    req.user?._id,
    'INTERNATIONAL_SHIPPING_UPDATE',
    'importDutyByCategory',
    before,
    doc.toObject(),
    `Updated duty rate for category: ${doc.category}`
  );

  res.status(200).json({
    status: 'success',
    data: { rate: doc },
  });
});

exports.deleteImportDutyByCategory = catchAsync(async (req, res, next) => {
  const id = req.params.id;
  const doc = await ImportDutyByCategory.findByIdAndDelete(id);
  if (!doc) {
    return next(new AppError('Category duty not found.', 404));
  }

  await logConfigChange(
    req.user?._id,
    'INTERNATIONAL_SHIPPING_UPDATE',
    'importDutyByCategory',
    doc.toObject(),
    null,
    `Deleted duty rate for category: ${doc.category}`
  );

  res.status(200).json({
    status: 'success',
    data: null,
    message: 'Deleted',
  });
});
