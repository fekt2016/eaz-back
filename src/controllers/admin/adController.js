const mongoose = require('mongoose');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const logger = require('../../utils/logger');
const AdvertisementModel = require('../../models/advertisementModel');
const { AD_TYPES } = AdvertisementModel;

const mapAdToResponse = (ad, { includeAdminFields = false } = {}) => {
  if (!ad) return null;
  const doc = typeof ad.toObject === 'function' ? ad.toObject({ getters: true }) : ad;

  const response = {
    id: doc._id?.toString() ?? doc.id,
    title: doc.title,
    imageUrl: doc.imageUrl,
    link: doc.link,
    type: doc.type,
    active: doc.active,
    startDate: doc.startDate,
    endDate: doc.endDate ?? null,
    discountPercent: typeof doc.discountPercent === 'number' ? doc.discountPercent : 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };

  if (includeAdminFields) {
    response.createdBy = doc.createdBy ?? null;
  }

  return response;
};

const parseDateInput = (value, fieldName) => {
  if (value === undefined || value === null || value === '') return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`Invalid ${fieldName}. Expected a valid date string or timestamp.`, 400);
  }
  return date;
};

const validateType = (type) => {
  if (type && !AD_TYPES.includes(type)) {
    throw new AppError(`Invalid advertisement type. Allowed values: ${AD_TYPES.join(', ')}`, 400);
  }
};

const validateDateRange = (startDate, endDate) => {
  if (startDate && endDate && endDate < startDate) {
    throw new AppError('End date must be greater than or equal to the start date.', 400);
  }
};

/**
 * Admin: Create advertisement
 * POST /api/v1/ads
 */
exports.createAd = catchAsync(async (req, res, next) => {
  const {
    title,
    imageUrl,
    link,
    type,
    active = true,
    startDate: startDateInput,
    endDate: endDateInput,
    discountPercent,
  } = req.body || {};

  validateType(type);
  const startDate = parseDateInput(startDateInput ?? new Date(), 'start date');
  const endDate = parseDateInput(endDateInput, 'end date');
  validateDateRange(startDate, endDate);

  let normalizedDiscount = 0;
  if (discountPercent !== undefined && discountPercent !== null && discountPercent !== '') {
    const value = Number(discountPercent);
    if (Number.isNaN(value) || value < 0 || value > 100) {
      throw new AppError('Discount percent must be a number between 0 and 100.', 400);
    }
    normalizedDiscount = value;
  }

  const payload = {
    title,
    imageUrl,
    link,
    type,
    active: Boolean(active),
    startDate,
    endDate,
    createdBy: req.user?.id || req.user?._id || null,
    discountPercent: normalizedDiscount,
  };

  const ad = await AdvertisementModel.create(payload);

  logger.info('[Advertisements] Created new advertisement', {
    adId: ad.id,
    createdBy: payload.createdBy,
    type,
  });

  res.status(201).json({
    status: 'success',
    data: {
      ad: mapAdToResponse(ad, { includeAdminFields: true }),
    },
  });
});

/**
 * Admin: Get advertisements list
 * GET /api/v1/ads
 */
exports.getAds = catchAsync(async (req, res, next) => {
  const filter = {};
  const { active, type, from, to } = req.query;

  if (typeof active !== 'undefined') {
    filter.active = active === 'true' || active === '1' || active === true;
  }

  if (type) {
    validateType(type);
    filter.type = type;
  }

  const fromDate = parseDateInput(from, 'from date');
  const toDate = parseDateInput(to, 'to date');

  if (fromDate || toDate) {
    filter.$and = [];
    if (fromDate) {
      filter.$and.push({ endDate: { $gte: fromDate } });
    }
    if (toDate) {
      filter.$and.push({ startDate: { $lte: toDate } });
    }
  }

  const ads = await AdvertisementModel.find(filter).sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: ads.length,
    data: {
      ads: ads.map((ad) => mapAdToResponse(ad, { includeAdminFields: true })),
    },
  });
});

/**
 * Admin: Update advertisement
 * PATCH /api/v1/ads/:id
 */
exports.updateAd = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new AppError('Invalid advertisement ID format', 400));
  }

  const ad = await AdvertisementModel.findById(id);
  if (!ad) {
    return next(new AppError('Advertisement not found', 404));
  }

  const updates = {};
  const allowedFields = ['title', 'imageUrl', 'link', 'type', 'active', 'startDate', 'endDate', 'discountPercent'];

  allowedFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      updates[field] = req.body[field];
    }
  });

  if (updates.type) {
    validateType(updates.type);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'active')) {
    updates.active = Boolean(updates.active);
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'startDate')) {
    updates.startDate = parseDateInput(updates.startDate, 'start date');
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'endDate')) {
    updates.endDate = parseDateInput(updates.endDate, 'end date');
  }

  if (Object.prototype.hasOwnProperty.call(updates, 'discountPercent')) {
    if (updates.discountPercent === '' || updates.discountPercent === null) {
      updates.discountPercent = 0;
    } else {
      const value = Number(updates.discountPercent);
      if (Number.isNaN(value) || value < 0 || value > 100) {
        throw new AppError('Discount percent must be a number between 0 and 100.', 400);
      }
      updates.discountPercent = value;
    }
  }

  const startDate = updates.startDate ?? ad.startDate;
  const endDate = Object.prototype.hasOwnProperty.call(updates, 'endDate')
    ? updates.endDate
    : ad.endDate;

  validateDateRange(startDate, endDate);

  Object.entries(updates).forEach(([key, value]) => {
    if (typeof value !== 'undefined') {
      ad[key] = value;
    } else if (value === null) {
      ad[key] = null;
    }
  });

  await ad.save();

  logger.info('[Advertisements] Updated advertisement', { adId: ad.id });

  res.status(200).json({
    status: 'success',
    data: {
      ad: mapAdToResponse(ad, { includeAdminFields: true }),
    },
  });
});

/**
 * Admin: Delete advertisement
 * DELETE /api/v1/ads/:id
 */
exports.deleteAd = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new AppError('Invalid advertisement ID format', 400));
  }

  const ad = await AdvertisementModel.findByIdAndDelete(id);
  if (!ad) {
    return next(new AppError('Advertisement not found', 404));
  }

  logger.info('[Advertisements] Deleted advertisement', { adId: id });

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

/**
 * Public: Get active advertisements
 * GET /api/v1/ads/public
 */
exports.getPublicAds = catchAsync(async (req, res, next) => {
  const ads = await AdvertisementModel.findActive();

  res.status(200).json({
    status: 'success',
    results: ads.length,
    data: {
      ads: ads.map((ad) => mapAdToResponse(ad)),
    },
  });
});
