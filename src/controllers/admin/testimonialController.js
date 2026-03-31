const Testimonial = require('../../models/testimonial/testimonialModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

/**
 * List all testimonials with filters
 * GET /api/v1/admin/testimonials
 */
exports.getAllTestimonials = catchAsync(async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  const query = {};
  const allowedStatuses = ['pending', 'approved', 'rejected'];
  if (status && allowedStatuses.includes(status)) {
    query.status = status;
  }

  const [testimonials, total] = await Promise.all([
    Testimonial.find(query)
      .populate('seller', 'businessName email logo')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Testimonial.countDocuments(query),
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

/**
 * Approve a testimonial and publish it to the homepage
 * PATCH /api/v1/admin/testimonials/:id/approve
 */
exports.approveTestimonial = catchAsync(async (req, res, next) => {
  const testimonial = await Testimonial.findById(req.params.id);

  if (!testimonial) {
    return next(new AppError('Testimonial not found', 404));
  }

  testimonial.status = 'approved';
  testimonial.isPublished = true;
  testimonial.adminNote = undefined;
  await testimonial.save();

  logActivityAsync({
    userId: req.user.id,
    role: 'admin',
    action: 'TESTIMONIAL_APPROVED',
    description: `Admin approved testimonial ${testimonial._id}`,
    req,
    metadata: { testimonialId: testimonial._id, sellerId: testimonial.seller },
  });

  res.status(200).json({
    status: 'success',
    message: 'Testimonial approved and published to homepage',
    data: { testimonial },
  });
});

/**
 * Reject a testimonial with an optional note
 * PATCH /api/v1/admin/testimonials/:id/reject
 */
exports.rejectTestimonial = catchAsync(async (req, res, next) => {
  const { note } = req.body;

  const testimonial = await Testimonial.findById(req.params.id);

  if (!testimonial) {
    return next(new AppError('Testimonial not found', 404));
  }

  testimonial.status = 'rejected';
  testimonial.isPublished = false;
  if (note && typeof note === 'string') {
    testimonial.adminNote = note.trim().slice(0, 300);
  }
  await testimonial.save();

  logActivityAsync({
    userId: req.user.id,
    role: 'admin',
    action: 'TESTIMONIAL_REJECTED',
    description: `Admin rejected testimonial ${testimonial._id}`,
    req,
    metadata: { testimonialId: testimonial._id, sellerId: testimonial.seller },
  });

  res.status(200).json({
    status: 'success',
    message: 'Testimonial rejected',
    data: { testimonial },
  });
});

/**
 * Unpublish an approved testimonial (remove from homepage without deleting)
 * PATCH /api/v1/admin/testimonials/:id/unpublish
 */
exports.unpublishTestimonial = catchAsync(async (req, res, next) => {
  const testimonial = await Testimonial.findById(req.params.id);

  if (!testimonial) {
    return next(new AppError('Testimonial not found', 404));
  }

  testimonial.isPublished = false;
  await testimonial.save();

  logActivityAsync({
    userId: req.user.id,
    role: 'admin',
    action: 'TESTIMONIAL_UNPUBLISHED',
    description: `Admin unpublished testimonial ${testimonial._id}`,
    req,
    metadata: { testimonialId: testimonial._id },
  });

  res.status(200).json({
    status: 'success',
    message: 'Testimonial removed from homepage',
    data: { testimonial },
  });
});

/**
 * Hard delete a testimonial
 * DELETE /api/v1/admin/testimonials/:id
 */
exports.deleteTestimonial = catchAsync(async (req, res, next) => {
  const testimonial = await Testimonial.findByIdAndDelete(req.params.id);

  if (!testimonial) {
    return next(new AppError('Testimonial not found', 404));
  }

  logActivityAsync({
    userId: req.user.id,
    role: 'admin',
    action: 'TESTIMONIAL_DELETED',
    description: `Admin deleted testimonial ${testimonial._id}`,
    req,
    metadata: { testimonialId: req.params.id },
  });

  res.status(200).json({
    status: 'success',
    message: 'Testimonial deleted',
  });
});
