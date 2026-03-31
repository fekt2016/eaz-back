const Testimonial = require('../../models/testimonial/testimonialModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
const logger = require('../../utils/logger');

/**
 * Get the current seller's testimonial
 * GET /api/v1/seller/testimonials/me
 */
exports.getMyTestimonial = catchAsync(async (req, res, next) => {
  const testimonial = await Testimonial.findOne({
    seller: req.user.id,
    status: { $in: ['pending', 'approved'] },
  }).lean();

  res.status(200).json({
    status: 'success',
    data: { testimonial },
  });
});

/**
 * Create or update seller's testimonial
 * POST /api/v1/seller/testimonials
 */
exports.createTestimonial = catchAsync(async (req, res, next) => {
  const { content, rating } = req.body;

  if (!content || !rating) {
    return next(new AppError('Content and rating are required', 400));
  }

  if (typeof content !== 'string' || content.trim().length < 10) {
    return next(new AppError('Testimonial must be at least 10 characters', 400));
  }

  if (content.trim().length > 500) {
    return next(new AppError('Testimonial cannot exceed 500 characters', 400));
  }

  const numRating = Number(rating);
  if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
    return next(new AppError('Rating must be an integer between 1 and 5', 400));
  }

  // Check if seller already has an active testimonial
  const existing = await Testimonial.findOne({
    seller: req.user.id,
    status: { $in: ['pending', 'approved'] },
  });

  if (existing) {
    return next(
      new AppError('You already have an active testimonial. Please edit or delete it first.', 400)
    );
  }

  const testimonial = await Testimonial.create({
    seller: req.user.id,
    content: content.trim(),
    rating: numRating,
  });

  logActivityAsync({
    userId: req.user.id,
    role: 'seller',
    action: 'TESTIMONIAL_CREATED',
    description: `Seller submitted a testimonial with rating ${numRating}`,
    req,
    metadata: { testimonialId: testimonial._id },
  });

  res.status(201).json({
    status: 'success',
    message: 'Testimonial submitted successfully. It will be visible once approved.',
    data: { testimonial },
  });
});

/**
 * Update seller's testimonial
 * PATCH /api/v1/seller/testimonials/:id
 */
exports.updateTestimonial = catchAsync(async (req, res, next) => {
  const { content, rating } = req.body;

  const testimonial = await Testimonial.findOne({
    _id: req.params.id,
    seller: req.user.id,
  });

  if (!testimonial) {
    return next(new AppError('Testimonial not found', 404));
  }

  if (content !== undefined) {
    if (typeof content !== 'string' || content.trim().length < 10) {
      return next(new AppError('Testimonial must be at least 10 characters', 400));
    }
    if (content.trim().length > 500) {
      return next(new AppError('Testimonial cannot exceed 500 characters', 400));
    }
    testimonial.content = content.trim();
    // Reset to pending on edit
    testimonial.status = 'pending';
    testimonial.isPublished = false;
  }

  if (rating !== undefined) {
    const numRating = Number(rating);
    if (!Number.isInteger(numRating) || numRating < 1 || numRating > 5) {
      return next(new AppError('Rating must be an integer between 1 and 5', 400));
    }
    testimonial.rating = numRating;
  }

  await testimonial.save();

  logActivityAsync({
    userId: req.user.id,
    role: 'seller',
    action: 'TESTIMONIAL_UPDATED',
    description: 'Seller updated their testimonial',
    req,
    metadata: { testimonialId: testimonial._id },
  });

  res.status(200).json({
    status: 'success',
    message: 'Testimonial updated. It will be re-reviewed.',
    data: { testimonial },
  });
});

/**
 * Delete seller's testimonial
 * DELETE /api/v1/seller/testimonials/:id
 */
exports.deleteTestimonial = catchAsync(async (req, res, next) => {
  const testimonial = await Testimonial.findOneAndDelete({
    _id: req.params.id,
    seller: req.user.id,
  });

  if (!testimonial) {
    return next(new AppError('Testimonial not found', 404));
  }

  logActivityAsync({
    userId: req.user.id,
    role: 'seller',
    action: 'TESTIMONIAL_DELETED',
    description: 'Seller deleted their testimonial',
    req,
    metadata: { testimonialId: req.params.id },
  });

  res.status(200).json({
    status: 'success',
    message: 'Testimonial deleted successfully',
  });
});

/**
 * Get all approved & published testimonials (public)
 * GET /api/v1/seller/testimonials/public
 */
exports.getPublicTestimonials = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 10 } = req.query;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [testimonials, total] = await Promise.all([
    Testimonial.find({ status: 'approved', isPublished: true })
      .populate('seller', 'businessName logo')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Testimonial.countDocuments({ status: 'approved', isPublished: true }),
  ]);

  res.status(200).json({
    status: 'success',
    results: testimonials.length,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      total,
      limit: limitNum,
    },
    data: { testimonials },
  });
});
