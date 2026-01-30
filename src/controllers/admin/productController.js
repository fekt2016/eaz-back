const catchAsync = require('../../utils/helpers/catchAsync');
const AppError = require('../../utils/errors/appError');
const Product = require('../../models/product/productModel');
const OrderItem = require('../../models/order/OrderItemModel');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');
const logger = require('../../utils/logger');
const mongoose = require('mongoose');

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
  
  // Verify adminId exists
  if (!adminId) {
    logger.error('[Approve Product] Admin ID is missing');
    return next(new AppError('Invalid admin credentials', 401));
  }
  
  // Verify user is admin
  if (adminRole !== 'admin' && adminRole !== 'superadmin' && adminRole !== 'moderator') {
    logger.error('[Approve Product] User is not admin:', { role: adminRole, userId: adminId });
    return next(new AppError('Admin access required', 403));
  }
  
  // Validate product ID format
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    logger.error(`[Approve Product] Invalid product ID format: ${id}`);
    return next(new AppError('Invalid product ID format', 400));
  }
  
  logger.info(`[Approve Product] Admin ${adminId} (${adminRole}) attempting to approve product ${id}`);

  const product = await Product.findById(id);
  if (!product) {
    logger.error(`[Approve Product] Product not found: ${id}`);
    return next(new AppError('Product not found', 404));
  }

  // Check if product is already approved
  if (product.moderationStatus === 'approved') {
    logger.info(`[Approve Product] Product ${id} is already approved`);
    return res.status(200).json({
      status: 'success',
      message: 'Product is already approved',
      data: {
        product: {
          id: product._id,
          name: product.name,
          moderationStatus: product.moderationStatus,
        },
      },
    });
  }

  // Update product moderation status
  product.moderationStatus = 'approved';
  product.moderatedBy = adminId;
  product.moderatedAt = new Date();
  if (notes) {
    product.moderationNotes = notes;
  }

  // CRITICAL: Ensure product status is 'active' when approved
  // Products must be active to be visible to buyers
  if (product.status !== 'active' && product.status !== 'out_of_stock') {
    product.status = 'active';
    logger.info(`[Approve Product] Set product status to 'active' (was: ${product.status})`);
  }

  // CRITICAL: Set product as visible when approved
  // NOTE: Seller verification is NOT required - approved products are visible regardless of seller verification
  // Product is visible if: status is active/out_of_stock AND moderation is approved
  const shouldBeVisible = 
    (product.status === 'active' || product.status === 'out_of_stock') &&
    product.moderationStatus === 'approved';
  
  product.isVisible = shouldBeVisible;
  
  logger.info(`[Approve Product] Visibility set: ${shouldBeVisible}`, {
    productStatus: product.status,
    moderationStatus: product.moderationStatus,
  });

  // Pre-save validation: Ensure prices are valid before saving
  const variantPrices = product.variants
    .map(v => parseFloat(v.price) || 0)
    .filter(p => p > 0 && isFinite(p));
  
  if (variantPrices.length === 0) {
    logger.error(`[Approve Product] Product ${id} has no valid variant prices`);
    return next(new AppError('Product must have at least one variant with a valid price greater than 0', 400));
  }

  // Set main product price from first valid variant if missing
  if (!product.price || isNaN(product.price) || product.price <= 0) {
    product.price = Math.min(...variantPrices);
    logger.info(`[Approve Product] Auto-set product price to ${product.price} from variants`);
  }

  // Final validation: Ensure main price is valid
  const mainPrice = parseFloat(product.price);
  if (!mainPrice || isNaN(mainPrice) || mainPrice <= 0) {
    logger.error(`[Approve Product] Product ${id} has invalid main price: ${product.price}`);
    return next(new AppError('Product price is required and must be greater than 0', 400));
  }

  try {
    await product.save({ validateBeforeSave: true });
    
    // CRITICAL: Verify the moderationStatus was actually saved
    // Re-fetch the product to ensure the update persisted
    const updatedProduct = await Product.findById(id).select('moderationStatus isVisible moderatedBy moderatedAt');
    
    if (!updatedProduct) {
      logger.error(`[Approve Product] Product ${id} not found after save`);
      return next(new AppError('Failed to verify product approval', 500));
    }
    
    if (updatedProduct.moderationStatus !== 'approved') {
      logger.error(`[Approve Product] ❌ moderationStatus not updated correctly. Expected: 'approved', Got: '${updatedProduct.moderationStatus}'`);
      return next(new AppError('Failed to update product moderation status', 500));
    }
    
    logger.info(`[Approve Product] ✅ Product ${id} approved successfully by admin ${adminId}`, {
      productId: product._id,
      moderationStatus: updatedProduct.moderationStatus,
      isVisible: updatedProduct.isVisible,
      moderatedBy: updatedProduct.moderatedBy,
      moderatedAt: updatedProduct.moderatedAt,
    });

    // Log activity
    logActivityAsync({
      userId: adminId,
      role: 'admin',
      action: 'APPROVE_PRODUCT',
      description: `Admin approved product: ${product.name}`,
      metadata: {
        productId: product._id,
        productName: product.name,
        sellerId: product.seller,
        notes: notes || null,
        moderationStatus: updatedProduct.moderationStatus,
        isVisible: updatedProduct.isVisible,
      },
      req,
    });

    res.status(200).json({
      status: 'success',
      message: 'Product approved successfully',
      data: {
        product: {
          id: product._id,
          name: product.name,
          moderationStatus: updatedProduct.moderationStatus,
          isVisible: updatedProduct.isVisible,
          moderatedBy: updatedProduct.moderatedBy,
          moderatedAt: updatedProduct.moderatedAt,
        },
      },
    });
  } catch (error) {
    logger.error(`[Approve Product] Error saving product ${id}:`, error);
    
    // Handle validation errors specifically
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        path: err.path,
        message: err.message,
        value: err.value,
      }));
      
      logger.error(`[Approve Product] Validation errors:`, validationErrors);
      
      const errorMessages = validationErrors.map(err => `${err.path}: ${err.message}`).join(', ');
      return next(new AppError(`Validation error: ${errorMessages}`, 400));
    }
    
    return next(new AppError(error.message || 'Failed to approve product', 500));
  }
});

/**
 * Reject a product
 * PATCH /api/v1/admin/products/:id/reject
 */
exports.rejectProduct = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { notes } = req.body;
  
  // Check if user is authenticated
  if (!req.user) {
    logger.error('[Reject Product] No user found in request');
    return next(new AppError('Authentication required', 401));
  }
  
  const adminId = req.user.id || req.user._id;
  const adminRole = req.user.role;
  
  // Verify adminId exists
  if (!adminId) {
    logger.error('[Reject Product] Admin ID is missing');
    return next(new AppError('Invalid admin credentials', 401));
  }
  
  // Verify user is admin
  if (adminRole !== 'admin' && adminRole !== 'superadmin' && adminRole !== 'moderator') {
    logger.error('[Reject Product] User is not admin:', { role: adminRole, userId: adminId });
    return next(new AppError('Admin access required', 403));
  }
  
  // Validate product ID format
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    logger.error(`[Reject Product] Invalid product ID format: ${id}`);
    return next(new AppError('Invalid product ID format', 400));
  }
  
  logger.info(`[Reject Product] Admin ${adminId} (${adminRole}) attempting to reject product ${id}`);

  const product = await Product.findById(id);
  if (!product) {
    logger.error(`[Reject Product] Product not found: ${id}`);
    return next(new AppError('Product not found', 404));
  }

  // Check if product is already rejected
  if (product.moderationStatus === 'rejected') {
    logger.info(`[Reject Product] Product ${id} is already rejected`);
    return res.status(200).json({
      status: 'success',
      message: 'Product is already rejected',
      data: {
        product: {
          id: product._id,
          name: product.name,
          moderationStatus: product.moderationStatus,
        },
      },
    });
  }

  // Update product moderation status
  product.moderationStatus = 'rejected';
  product.moderatedBy = adminId;
  product.moderatedAt = new Date();
  product.isVisible = false; // Rejected products are never visible
  if (notes) {
    product.moderationNotes = notes;
  }

  try {
    await product.save({ validateBeforeSave: true });
    logger.info(`[Reject Product] ✅ Product ${id} rejected successfully by admin ${adminId}`);

    // Log activity
    if (product.seller && mongoose.Types.ObjectId.isValid(product.seller)) {
      logActivityAsync({
        userId: adminId,
        role: 'admin',
        action: 'REJECT_PRODUCT',
        description: `Admin rejected product: ${product.name}`,
        metadata: {
          productId: product._id,
          productName: product.name,
          sellerId: product.seller,
          notes: notes || null,
        },
        req,
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Product rejected successfully',
      data: {
        product: {
          id: product._id,
          name: product.name,
          moderationStatus: product.moderationStatus,
          isVisible: product.isVisible,
        },
      },
    });
  } catch (error) {
    logger.error(`[Reject Product] Error saving product ${id}:`, error);
    return next(new AppError(error.message || 'Failed to reject product', 500));
  }
});

/**
 * Get pending products for moderation
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
 * Fix visibility for approved products (admin only)
 * POST /api/v1/admin/products/fix-approved-visibility
 * Updates isVisible for all approved products based on seller verification status
 */
exports.fixApprovedProductsVisibility = catchAsync(async (req, res, next) => {
  const adminId = req.user.id || req.user._id;
  const adminRole = req.user.role;
  
  // Verify user is admin
  if (adminRole !== 'admin' && adminRole !== 'superadmin' && adminRole !== 'moderator') {
    return next(new AppError('Admin access required', 403));
  }
  
  logger.info(`[Fix Approved Products Visibility] Admin ${adminId} fixing visibility for approved products`);
  
  const Seller = require('../../models/user/sellerModel');
  const { updateSellerProductsVisibility } = require('../../utils/helpers/productVisibility');
  
  // Get all approved products
  const approvedProducts = await Product.find({ 
    moderationStatus: 'approved',
    status: { $in: ['active', 'out_of_stock'] }
  }).select('_id seller status moderationStatus isVisible');
  
  logger.info(`[Fix Approved Products Visibility] Found ${approvedProducts.length} approved products`);
  
  // Group products by seller
  const productsBySeller = {};
  for (const product of approvedProducts) {
    const sellerId = product.seller.toString();
    if (!productsBySeller[sellerId]) {
      productsBySeller[sellerId] = [];
    }
    productsBySeller[sellerId].push(product);
  }
  
  let totalUpdated = 0;
  const sellerIds = Object.keys(productsBySeller);
  
  // Update visibility for each seller's products
  for (const sellerId of sellerIds) {
    try {
      const seller = await Seller.findById(sellerId).select('verificationStatus');
      if (!seller) {
        logger.warn(`[Fix Approved Products Visibility] Seller ${sellerId} not found, skipping products`);
        continue;
      }
      
      const isVerified = seller.verificationStatus === 'verified';
      const products = productsBySeller[sellerId];
      
      // Update each product's visibility.
      // Product is visible to buyers only if:
      // - the seller is verified
      // - the product is active / out_of_stock
      // - the product is approved
      // - the product is not soft‑deleted
      for (const product of products) {
        const shouldBeVisible =
          isVerified &&
          (product.status === 'active' || product.status === 'out_of_stock') &&
          product.moderationStatus === 'approved' &&
          !product.isDeleted &&
          !product.isDeletedByAdmin &&
          !product.isDeletedBySeller;
        
        if (product.isVisible !== shouldBeVisible) {
          await Product.findByIdAndUpdate(
            product._id,
            { isVisible: shouldBeVisible },
            { runValidators: false }
          );
          totalUpdated++;
          logger.info(`[Fix Approved Products Visibility] Updated product ${product._id}: isVisible=${shouldBeVisible}`, {
            productStatus: product.status,
            moderationStatus: product.moderationStatus,
          });
        }
      }
    } catch (error) {
      logger.error(`[Fix Approved Products Visibility] Error updating products for seller ${sellerId}:`, error);
      // Continue with other sellers
    }
  }
  
  logger.info(`[Fix Approved Products Visibility] ✅ Updated visibility for ${totalUpdated} products across ${sellerIds.length} sellers`);
  
  res.status(200).json({
    status: 'success',
    message: `Updated visibility for ${totalUpdated} approved products`,
    data: {
      sellersProcessed: sellerIds.length,
      productsUpdated: totalUpdated,
      totalApprovedProducts: approvedProducts.length,
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
  
  let updatedCount = 0;
  for (const seller of sellers) {
    try {
      const count = await updateSellerProductsVisibility(seller._id);
      updatedCount += count;
      logger.info(`[Update Visibility] Updated ${count} products for seller ${seller._id}`);
    } catch (error) {
      logger.error(`[Update Visibility] Error updating products for seller ${seller._id}:`, error);
      // Continue with other sellers
    }
  }
  
  logger.info(`[Update Visibility] ✅ Updated visibility for ${updatedCount} products across ${sellers.length} sellers`);
  
  res.status(200).json({
    status: 'success',
    message: `Updated visibility for ${updatedCount} products`,
    data: {
      sellersProcessed: sellers.length,
      productsUpdated: updatedCount,
    },
  });
});

/**
 * Admin-only product removal (soft delete/archive or hard delete)
 * DELETE /api/v1/admin/products/:productId
 *
 * RULES:
 * - Products with orders cannot be deleted – order history must be preserved.
 * - Not approved + no orders → hard delete from database completely.
 * - Approved (or already archived) + no orders → soft delete (archive) or hard delete if already archived + forceDelete.
 * - Price and variant validation do not block delete – archive is saved with validateBeforeSave: false.
 */
exports.removeProduct = catchAsync(async (req, res, next) => {
  const { productId } = req.params;
  const { reason, forceDelete } = req.body; // forceDelete requires explicit request
  
  // Verify admin authentication
  if (!req.user) {
    logger.error('[Remove Product] No user found in request');
    console.error('[Remove Product] No user found in request');
    return next(new AppError('Authentication required', 401));
  }
  
  const adminId = req.user.id || req.user._id;
  const adminRole = req.user.role;
  
  // Verify admin credentials
  if (!adminId) {
    logger.error('[Remove Product] Admin ID is missing');
    console.error('[Remove Product] Admin ID is missing');
    return next(new AppError('Invalid admin credentials', 401));
  }
  
  // Verify user is admin
  if (adminRole !== 'admin' && adminRole !== 'superadmin' && adminRole !== 'moderator') {
    logger.error('[Remove Product] User is not admin:', { role: adminRole, userId: adminId });
    console.error('[Remove Product] User is not admin:', { role: adminRole, userId: adminId });
    return next(new AppError('Admin access required', 403));
  }
  
  // Validate product ID format
  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
    logger.error(`[Remove Product] Invalid product ID format: ${productId}`);
    console.error('[Remove Product] Invalid product ID format:', productId);
    return next(new AppError('Invalid product ID format', 400));
  }
  
  logger.info(`[Remove Product] Admin ${adminId} (${adminRole}) attempting to remove product ${productId}`, {
    forceDelete: forceDelete || false,
    reason: reason || 'Not provided',
  });
  
  // Find product
  const product = await Product.findById(productId).populate('seller', '_id shopName email');
  
  if (!product) {
    logger.error(`[Remove Product] Product not found: ${productId}`);
    console.error('[Remove Product] Product not found:', productId);
    return next(new AppError('Product not found', 404));
  }
  
  // Block delete when product has orders – neither soft nor hard delete allowed
  const orderCount = await OrderItem.countDocuments({ product: productId }).maxTimeMS(10000);
  if (orderCount > 0) {
    logger.warn(`[Remove Product] Delete blocked: product ${productId} has ${orderCount} order(s)`);
    console.error('[Remove Product] Delete blocked: product has orders', { productId, orderCount });
    return next(new AppError(
      'This product cannot be deleted because it has order history. Products with orders must be preserved.',
      400
    ));
  }
  
  // Not approved + no orders → hard delete from database completely
  const isApproved = product.moderationStatus === 'approved';
  if (!isApproved) {
    logger.info(`[Remove Product] Product ${productId} not approved (moderationStatus: ${product.moderationStatus}), zero orders – hard delete from DB`);
    try {
      await Product.findByIdAndDelete(productId);
      logActivityAsync({
        userId: adminId,
        role: 'admin',
        action: 'ADMIN_PRODUCT_HARD_DELETE',
        description: `Admin permanently deleted unapproved product: ${product.name}`,
        metadata: {
          productId: product._id,
          productName: product.name,
          sellerId: product.seller?._id || product.seller,
          reason: reason || 'Not provided',
          moderationStatus: product.moderationStatus,
        },
        req,
      });
      logger.info(`[Remove Product] ✅ Product ${productId} hard deleted by admin ${adminId} (unapproved, no orders)`);
      return res.status(200).json({
        success: true,
        message: 'Product permanently deleted',
        data: {
          productId: product._id,
          action: 'hard_delete',
          note: 'Unapproved product with no orders removed from database',
        },
      });
    } catch (error) {
      logger.error(`[Remove Product] Error during hard delete (unapproved):`, error);
      console.error('[Remove Product] Error during hard delete (unapproved):', error?.message || error, error);
      return next(new AppError('Failed to delete product', 500));
    }
  }
  
  // Check if product is already archived
  if (product.isDeleted && product.status === 'archived') {
    logger.info(`[Remove Product] Product ${productId} is already archived`);
    
    if (forceDelete === true) {
      logger.info(`[Remove Product] Performing hard delete on product ${productId} (admin request, zero orders)`);
      
      try {
        await Product.findByIdAndDelete(productId);
        
        logActivityAsync({
          userId: adminId,
          role: 'admin',
          action: 'ADMIN_PRODUCT_HARD_DELETE',
          description: `Admin permanently deleted product: ${product.name}`,
          metadata: {
            productId: product._id,
            productName: product.name,
            sellerId: product.seller?._id || product.seller,
            reason: reason || 'Not provided',
          },
          req,
        });
        
        logger.info(`[Remove Product] ✅ Product ${productId} permanently deleted by admin ${adminId}`);
        
        return res.status(200).json({
          success: true,
          message: 'Product permanently deleted',
          data: {
            productId: product._id,
            action: 'hard_delete',
          },
        });
      } catch (error) {
        logger.error(`[Remove Product] Error during hard delete:`, error);
        console.error('[Remove Product] Error during hard delete (archived):', error?.message || error, error);
        return next(new AppError('Failed to delete product', 500));
      }
    }
    
    return res.status(200).json({
      success: true,
      message: 'Product is already archived',
      data: {
        productId: product._id,
        action: 'already_archived',
      },
    });
  }
  
  // Perform soft delete (archive) – do not let price/variant validation block delete
  product.status = 'archived';
  product.isDeleted = true;
  product.isDeletedByAdmin = true;
  product.isDeletedBySeller = false;
  product.deletedAt = new Date();
  product.deletedBy = adminId;
  product.deletedByRole = 'admin';
  product.deletionReason = reason || null;
  product.isVisible = false;
  
  try {
    await product.save({ validateBeforeSave: false });
    
    logger.info(`[Remove Product] ✅ Product ${productId} archived successfully by admin ${adminId}`, {
      orderCount,
      hasOrders: orderCount > 0,
    });
    
    // Log activity
    logActivityAsync({
      userId: adminId,
      role: 'admin',
      action: 'ADMIN_PRODUCT_ARCHIVE',
      description: `Admin archived product: ${product.name}`,
      metadata: {
        productId: product._id,
        productName: product.name,
        sellerId: product.seller?._id || product.seller,
        reason: reason || 'Not provided',
        orderCount,
        hasOrders: orderCount > 0,
      },
      req,
    });
    
    res.status(200).json({
      success: true,
      message: 'Product removed from marketplace',
      data: {
        productId: product._id,
        action: 'archived',
        hasOrders: orderCount > 0,
        orderCount,
        note: orderCount > 0 
          ? 'Product archived but preserved due to order history' 
          : 'Product archived successfully',
      },
    });
  } catch (error) {
    logger.error(`[Remove Product] Error archiving product ${productId}:`, error);
    console.error('[Remove Product] Error archiving product:', productId, error?.message || error, error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        path: err.path,
        message: err.message,
      }));
      logger.error(`[Remove Product] Validation errors:`, validationErrors);
      console.error('[Remove Product] Validation errors:', validationErrors);
      return next(new AppError(`Validation error: ${validationErrors.map(e => e.message).join(', ')}`, 400));
    }
    
    console.error('[Remove Product] Unexpected error:', error?.message || error);
    return next(new AppError(error.message || 'Failed to archive product', 500));
  }
});
