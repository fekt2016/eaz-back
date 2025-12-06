const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Product = require('../../models/product/productModel');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

/**
 * Approve a product
 * PATCH /api/v1/admin/products/:id/approve
 */
exports.approveProduct = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { notes } = req.body;
  const adminId = req.user.id;

  const product = await Product.findById(id);
  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  if (product.moderationStatus === 'approved') {
    return next(new AppError('Product is already approved', 400));
  }

  // Update product
  product.moderationStatus = 'approved';
  product.moderationNotes = notes || product.moderationNotes;
  product.moderatedBy = adminId;
  product.moderatedAt = new Date();
  await product.save();

  // Notify seller about product approval
  try {
    const notificationService = require('../../services/notification/notificationService');
    await notificationService.createProductNotification(
      product.seller,
      product._id,
      'approved',
      product.name
    );
    console.log(`[Approve Product] Notification created for seller ${product.seller}`);
  } catch (notificationError) {
    console.error('[Approve Product] Error creating notification:', notificationError);
    // Don't fail approval if notification fails
  }

  // Log activity
  logActivityAsync({
    userId: adminId,
    role: 'admin',
    action: 'APPROVE_PRODUCT',
    description: `Approved product: ${product.name}`,
    req,
    metadata: { productId: product._id, sellerId: product.seller },
  });

  res.status(200).json({
    status: 'success',
    message: 'Product approved successfully',
    data: {
      product: {
        id: product._id,
        name: product.name,
        moderationStatus: product.moderationStatus,
      },
    },
  });
});

/**
 * Reject a product
 * PATCH /api/v1/admin/products/:id/reject
 */
exports.rejectProduct = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { notes, reason } = req.body;
  const adminId = req.user.id;

  if (!notes && !reason) {
    return next(new AppError('Rejection reason or notes are required', 400));
  }

  const product = await Product.findById(id);
  if (!product) {
    return next(new AppError('Product not found', 404));
  }

  if (product.moderationStatus === 'rejected') {
    return next(new AppError('Product is already rejected', 400));
  }

  // Update product
  product.moderationStatus = 'rejected';
  product.moderationNotes = notes || reason || product.moderationNotes;
  product.moderatedBy = adminId;
  product.moderatedAt = new Date();
  // Set status to inactive when rejected
  product.status = 'inactive';
  await product.save();

  // Notify seller about product rejection
  try {
    const notificationService = require('../../services/notification/notificationService');
    await notificationService.createProductNotification(
      product.seller,
      product._id,
      'rejected',
      product.name
    );
    console.log(`[Reject Product] Notification created for seller ${product.seller}`);
  } catch (notificationError) {
    console.error('[Reject Product] Error creating notification:', notificationError);
    // Don't fail rejection if notification fails
  }

  // Log activity
  logActivityAsync({
    userId: adminId,
    role: 'admin',
    action: 'REJECT_PRODUCT',
    description: `Rejected product: ${product.name}. Reason: ${notes || reason}`,
    req,
    metadata: { productId: product._id, sellerId: product.seller },
  });

  res.status(200).json({
    status: 'success',
    message: 'Product rejected successfully',
    data: {
      product: {
        id: product._id,
        name: product.name,
        moderationStatus: product.moderationStatus,
        moderationNotes: product.moderationNotes,
      },
    },
  });
});

/**
 * Get products pending approval
 * GET /api/v1/admin/products/pending
 */
exports.getPendingProducts = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (page - 1) * limit;

  const products = await Product.find({ moderationStatus: 'pending' })
    .populate('seller', 'shopName name email')
    .populate('parentCategory', 'name')
    .populate('subCategory', 'name')
    .sort('-createdAt')
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Product.countDocuments({ moderationStatus: 'pending' });

  res.status(200).json({
    status: 'success',
    results: products.length,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    data: {
      products,
    },
  });
});

module.exports = exports;

