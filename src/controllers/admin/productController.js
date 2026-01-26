const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Product = require('../../models/product/productModel');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
const logger = require('../../utils/logger');

/**
 * Approve a product
 * PATCH /api/v1/admin/products/:id/approve
 */
exports.approveProduct = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { notes } = req.body;
  
  // Check if user is authenticated
  if (!req.user) {
    logger.error('[Approve Product] No user found in request');
    return next(new AppError('Authentication required', 401));
  }
  
  const adminId = req.user.id || req.user._id;
  const adminRole = req.user.role;
  
  // Verify user is admin
  if (adminRole !== 'admin' && adminRole !== 'superadmin' && adminRole !== 'moderator') {
    logger.error('[Approve Product] User is not admin:', { role: adminRole, userId: adminId });
    return next(new AppError('Admin access required', 403));
  }
  
  logger.info(`[Approve Product] Admin ${adminId} (${adminRole}) attempting to approve product ${id}`);

  const product = await Product.findById(id);
  if (!product) {
    logger.error(`[Approve Product] Product not found: ${id}`);
    return next(new AppError('Product not found', 404));
  }

  if (product.moderationStatus === 'approved') {
    logger.warn(`[Approve Product] Product ${id} is already approved`);
    return next(new AppError('Product is already approved', 400));
  }

  // Update product
  product.moderationStatus = 'approved';
  product.moderationNotes = notes || product.moderationNotes;
  product.moderatedBy = adminId;
  product.moderatedAt = new Date();
  
  // CRITICAL: Update visibility when product is approved
  // Visibility depends on: seller verification + product status + moderation status
  const Seller = require('../../models/user/sellerModel');
  const seller = await Seller.findById(product.seller);
  if (seller) {
    const shouldBeVisible = 
      seller.verificationStatus === 'verified' &&
      product.status === 'active' &&
      product.moderationStatus === 'approved';
    product.isVisible = shouldBeVisible;
    logger.info(`[Approve Product] Updated visibility: ${shouldBeVisible} (seller verified: ${seller.verificationStatus === 'verified'}, product status: ${product.status})`);
  }
  
  try {
    await product.save();
    logger.info(`[Approve Product] ✅ Product ${id} approved successfully by admin ${adminId}`);
  } catch (saveError) {
    logger.error(`[Approve Product] ❌ Error saving product ${id}:`, saveError);
    return next(new AppError('Failed to approve product', 500));
  }

  // Notify seller about product approval
  try {
    const notificationService = require('../../services/notification/notificationService');
    await notificationService.createProductNotification(
      product.seller,
      product._id,
      'approved',
      product.name
    );
    logger.info(`[Approve Product] Notification created for seller ${product.seller}`);
  } catch (notificationError) {
    logger.error('[Approve Product] Error creating notification:', notificationError);
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
  // Set visibility to false when rejected
  product.isVisible = false;
  await product.save();

  // Notify seller about product rejection
  try {
    const notificationService = require('../../services/notification/notificationService');
const logger = require('../../utils/logger');
    await notificationService.createProductNotification(
      product.seller,
      product._id,
      'rejected',
      product.name
    );
    logger.info(`[Reject Product] Notification created for seller ${product.seller}`);
  } catch (notificationError) {
    logger.error('[Reject Product] Error creating notification:', notificationError);
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

/**
 * Update visibility for all products (admin only)
 * POST /api/v1/admin/products/update-visibility
 * Useful for fixing visibility issues in production
 */
exports.updateAllProductsVisibility = catchAsync(async (req, res, next) => {
  const adminId = req.user.id || req.user._id;
  const adminRole = req.user.role;
  
  // Verify user is admin
  if (adminRole !== 'admin' && adminRole !== 'superadmin' && adminRole !== 'moderator') {
    return next(new AppError('Admin access required', 403));
  }
  
  logger.info(`[Update Visibility] Admin ${adminId} updating visibility for all products`);
  
  const { updateSellerProductsVisibility } = require('../../utils/helpers/productVisibility');
  const Seller = require('../../models/user/sellerModel');
  
  // Get all sellers
  const sellers = await Seller.find({}).select('_id verificationStatus');
  logger.info(`[Update Visibility] Found ${sellers.length} sellers`);
  
  let totalUpdated = 0;
  const results = [];
  
  // Update products for each seller
  for (const seller of sellers) {
    try {
      const result = await updateSellerProductsVisibility(
        seller._id,
        seller.verificationStatus
      );
      totalUpdated += result.updated;
      results.push({
        sellerId: seller._id,
        verificationStatus: seller.verificationStatus,
        updated: result.updated,
        total: result.total,
      });
    } catch (error) {
      logger.error(`[Update Visibility] Error updating products for seller ${seller._id}:`, error);
      results.push({
        sellerId: seller._id,
        error: error.message,
      });
    }
  }
  
  logger.info(`[Update Visibility] ✅ Updated ${totalUpdated} products`);
  
  // Log activity
  logActivityAsync({
    userId: adminId,
    role: 'admin',
    action: 'UPDATE_PRODUCT_VISIBILITY',
    description: `Updated visibility for ${totalUpdated} products`,
    req,
    metadata: { totalUpdated, sellersProcessed: sellers.length },
  });
  
  res.status(200).json({
    status: 'success',
    message: `Updated visibility for ${totalUpdated} products`,
    data: {
      totalUpdated,
      sellersProcessed: sellers.length,
      results,
    },
  });
});

module.exports = exports;

