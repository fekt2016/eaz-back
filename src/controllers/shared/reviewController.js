const Review = require('../../models/product/reviewModel');
const handleFactory = require('../shared/handleFactory');
const catchAsync = require('../../utils/helpers/catchAsync');
const Product = require('../../models/product/productModel');
const AppError = require('../../utils/errors/appError');

exports.setProductUserIds = (req, res, next) => {
  if (!req.body.product) req.body.product = req.params.productId;
  if (!req.body.user) req.body.user = req.user.id;
  next();
};
exports.getAllReview = handleFactory.getAll(Review, [
  { path: 'product', select: 'name imageCover seller' },
  { path: 'user', select: 'name photo' },
  { path: 'order', select: 'orderNumber' },
]);
exports.getReview = handleFactory.getOne(Review, [
  { path: 'product', select: 'name' },
  { path: 'user', select: 'name photo' },
]);
exports.createUserReview = catchAsync(async (req, res, next) => {
  // Allow nested routes
  if (!req.body.product) req.body.product = req.params.productId;
  if (!req.body.user) req.body.user = req.user.id;

  // Validate required fields
  const { rating, review, title, product, user, order, orderItem, variantSKU, images } = req.body;
  if (!rating || !review || !title) {
    return next(new AppError('Please provide rating, title, and comment', 400));
  }

  // SECURITY FIX #10: Sanitize user-generated content to prevent XSS
  const { sanitizeReview, sanitizeTitle } = require('../../utils/helpers/sanitizeUserContent');
  const sanitizedReview = sanitizeReview(review);
  const sanitizedTitle = sanitizeTitle(title);
  
  // Validate sanitized content is not empty
  if (!sanitizedReview || sanitizedReview.trim().length === 0) {
    return next(new AppError('Review comment cannot be empty', 400));
  }
  if (!sanitizedTitle || sanitizedTitle.trim().length === 0) {
    return next(new AppError('Review title cannot be empty', 400));
  }

  // Validate rating range (0.5 increments)
  if (rating < 0.5 || rating > 5) {
    return next(new AppError('Rating must be between 0.5 and 5', 400));
  }
  // Validate 0.5 increments
  if ((rating * 2) % 1 !== 0) {
    return next(new AppError('Rating must be in 0.5 increments (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)', 400));
  }

  // Check if product exists
  const productExists = await Product.findById(product).populate('seller');
  if (!productExists) {
    return next(new AppError('Product not found', 404));
  }

  // SECURITY: Prevent seller from reviewing their own product
  if (productExists.seller && productExists.seller._id.toString() === req.user.id) {
    return next(new AppError('You cannot review your own product', 403));
  }

  // VERIFY PURCHASE: Check if user purchased the product
  const Order = require('../../models/order/orderModel');
  const OrderItem = require('../../models/order/OrderItemModel');

  let purchaseOrder = null;
  let verifiedPurchase = false;
  let selectedOrderItem = null; // Declare outside if/else for scope

  // CRITICAL FIX: Order status must be 'delivered' ONLY (not 'completed' or 'paid')
  // This ensures reviews can only be created after actual delivery
  if (order) {
    // If order ID is provided, verify it belongs to user and is DELIVERED
    purchaseOrder = await Order.findOne({
      _id: order,
      user: req.user.id,
      $or: [
        { status: 'delivered' },
        { currentStatus: 'delivered' },
      ],
    }).populate('orderItems');

    if (!purchaseOrder) {
      return next(new AppError('Order not found, does not belong to you, or has not been delivered yet. Only delivered orders can be reviewed.', 403));
    }

    // CRITICAL: Order must be delivered (check both status fields)
    const isDelivered = purchaseOrder.status === 'delivered' || purchaseOrder.currentStatus === 'delivered';
    if (!isDelivered) {
      return next(new AppError('Only delivered orders can be reviewed. Please wait until your order is delivered.', 403));
    }

    // Check if order contains this product
    const orderItems = await OrderItem.find({ _id: { $in: purchaseOrder.orderItems } });
    const matchingItems = orderItems.filter(item => item.product.toString() === product.toString());

    if (matchingItems.length === 0) {
      return next(new AppError('This product is not in the specified order', 400));
    }

    // If orderItem ID is provided, verify it exists and matches
    if (orderItem) {
      selectedOrderItem = matchingItems.find(item => item._id.toString() === orderItem.toString());
      if (!selectedOrderItem) {
        return next(new AppError('The specified order item does not match this product in the order', 400));
      }
    } else {
      // If no orderItem specified, use the first matching item
      selectedOrderItem = matchingItems[0];
    }

    verifiedPurchase = true;
  } else {
    // If no order specified, check if user has any DELIVERED order with this product
    const userOrders = await Order.find({
      user: req.user.id,
      $or: [
        { status: 'delivered' },
        { currentStatus: 'delivered' },
      ],
    }).populate('orderItems');

    for (const userOrder of userOrders) {
      const orderItems = await OrderItem.find({ _id: { $in: userOrder.orderItems } });
      const matchingItems = orderItems.filter(item => item.product.toString() === product.toString());

      if (matchingItems.length > 0) {
        purchaseOrder = userOrder;
        // If orderItem specified, verify it matches
        if (orderItem) {
          const selectedItem = matchingItems.find(item => item._id.toString() === orderItem.toString());
          if (!selectedItem) {
            continue; // Try next order
          }
          selectedOrderItem = selectedItem;
        } else {
          selectedOrderItem = matchingItems[0];
        }
        verifiedPurchase = true;
        break;
      }
    }

    if (!purchaseOrder || !selectedOrderItem) {
      return next(new AppError('You can only review products you have purchased and that have been delivered', 403));
    }
  }

  // Check if user already reviewed this order item (enforce one review per order item)
  const existingReviewQuery = { user: req.user.id };
  if (selectedOrderItem) {
    // Use orderItem for precise duplicate prevention (one review per order item)
    existingReviewQuery.orderItem = selectedOrderItem._id;
  } else if (purchaseOrder) {
    // Fallback to product+order if orderItem not available
    existingReviewQuery.product = product;
    existingReviewQuery.order = purchaseOrder._id;
  } else {
    existingReviewQuery.product = product;
  }

  const existingReview = await Review.findOne(existingReviewQuery);

  if (existingReview) {
    return next(new AppError('You have already reviewed this order item', 400));
  }

  try {
    const newReview = await Review.create({
      rating,
      review: sanitizedReview, // SECURITY FIX #10: Use sanitized review
      title: sanitizedTitle, // SECURITY FIX #10: Use sanitized title
      product,
      user,
      order: purchaseOrder ? purchaseOrder._id : undefined,
      orderItem: selectedOrderItem ? selectedOrderItem._id : undefined,
      variantSKU: selectedOrderItem ? selectedOrderItem.sku : variantSKU || undefined,
      images: images || [],
      verifiedPurchase,
      status: 'pending', // New reviews start as pending
    });

    // Trigger seller rating recalculation (system-derived)
    try {
      const sellerRatingService = require('../../services/sellerRatingService');
      if (productExists.seller) {
        // Recalculate seller rating asynchronously (don't block response)
        sellerRatingService.updateSellerRating(productExists.seller._id).catch(err => {
          console.error('[Review] Error updating seller rating:', err);
        });
      }
    } catch (ratingError) {
      // Don't fail review creation if rating update fails
      console.error('[Review] Error triggering seller rating update:', ratingError);
    }

    res.status(201).json({
      status: 'success',
      data: {
        review: newReview,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return next(new AppError('You have already reviewed this order item', 400));
    }
    next(error);
  }
});

// Update review with security checks
exports.updateReview = catchAsync(async (req, res, next) => {
  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  // SECURITY FIX #10: Verify review ownership
  if (review.user.toString() !== req.user.id.toString()) {
    return next(new AppError('You are not authorized to update this review', 403));
  }

  // SECURITY: Check if user owns the review or is admin
  if (review.user.toString() !== req.user.id && req.user.role !== 'admin') {
    return next(new AppError('You can only update your own reviews', 403));
  }

  // CRITICAL FIX: Prevent editing after seller reply (best practice)
  if (review.sellerReply && review.sellerReply.reply) {
    return next(new AppError('You cannot edit a review after the seller has replied to it', 403));
  }

  // Don't allow changing product, user, or order
  const { product, user, order, ...updateData } = req.body;

  // SECURITY FIX #10: Sanitize user-generated content if being updated
  const { sanitizeReview, sanitizeTitle } = require('../../utils/helpers/sanitizeUserContent');
  if (updateData.review) {
    updateData.review = sanitizeReview(updateData.review);
    if (!updateData.review || updateData.review.trim().length === 0) {
      return next(new AppError('Review comment cannot be empty', 400));
    }
  }
  if (updateData.title) {
    updateData.title = sanitizeTitle(updateData.title);
    if (!updateData.title || updateData.title.trim().length === 0) {
      return next(new AppError('Review title cannot be empty', 400));
    }
  }

  // Validate rating if being updated (0.5 increments)
  if (updateData.rating !== undefined) {
    if (updateData.rating < 0.5 || updateData.rating > 5) {
      return next(new AppError('Rating must be between 0.5 and 5', 400));
    }
    if ((updateData.rating * 2) % 1 !== 0) {
      return next(new AppError('Rating must be in 0.5 increments (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)', 400));
    }
  }

  // If status is being changed, only admin can do it
  if (updateData.status && req.user.role !== 'admin') {
    delete updateData.status;
  }

  const updatedReview = await Review.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true, runValidators: true },
  );

  res.status(200).json({
    status: 'success',
    data: {
      review: updatedReview,
    },
  });
});

exports.deleteReview = catchAsync(async (req, res, next) => {
  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  // SECURITY FIX #10: Verify review ownership
  if (review.user.toString() !== req.user.id.toString()) {
    return next(new AppError('You are not authorized to delete this review', 403));
  }

  // SECURITY: Check if user owns the review or is admin
  if (review.user.toString() !== req.user.id && req.user.role !== 'admin') {
    return next(new AppError('You can only delete your own reviews', 403));
  }

  await Review.findByIdAndDelete(req.params.id);

  res.status(204).json({ data: null, status: 'success' });
});
exports.createReview = handleFactory.createOne(Review);

// ========== ADMIN MODERATION CONTROLLERS ==========

// Approve review
exports.approveReview = catchAsync(async (req, res, next) => {
  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  review.status = 'approved';
  review.moderationNotes = req.body.moderationNotes || review.moderationNotes;
  await review.save();

  // Recalculate product ratings
  await Review.calcAverageRatings(review.product);

  // Trigger seller rating recalculation (system-derived)
  try {
    const Product = require('../../models/product/productModel');
    const sellerRatingService = require('../../services/sellerRatingService');
    const product = await Product.findById(review.product).select('seller');
    if (product && product.seller) {
      sellerRatingService.updateSellerRating(product.seller).catch(err => {
        console.error('[Review Approval] Error updating seller rating:', err);
      });
    }
  } catch (ratingError) {
    console.error('[Review Approval] Error triggering seller rating update:', ratingError);
  }

  res.status(200).json({
    status: 'success',
    data: { review },
  });
});

// Reject review
exports.rejectReview = catchAsync(async (req, res, next) => {
  const { moderationNotes } = req.body;
  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  review.status = 'rejected';
  review.moderationNotes = moderationNotes || 'Review rejected by admin';
  await review.save();

  res.status(200).json({
    status: 'success',
    data: { review },
  });
});

// Flag review
exports.flagReview = catchAsync(async (req, res, next) => {
  const { flaggedReason, moderationNotes } = req.body;
  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  if (!flaggedReason) {
    return next(new AppError('Flagged reason is required', 400));
  }

  review.status = 'flagged';
  review.flaggedReason = flaggedReason;
  review.moderationNotes = moderationNotes || review.moderationNotes;
  await review.save();

  // Notify all admins about flagged review
  try {
    const notificationService = require('../../services/notification/notificationService');
    const Product = require('../../models/product/productModel');
    const product = await Product.findById(review.product).select('name');
    await notificationService.createReviewFlagNotification(
      review._id,
      review.product,
      product?.name || 'Product',
      flaggedReason || 'Inappropriate content'
    );
    console.log(`[Review Flag] Admin notification created for review ${review._id}`);
  } catch (notificationError) {
    console.error('[Review Flag] Error creating admin notification:', notificationError);
    // Don't fail review flagging if notification fails
  }

  res.status(200).json({
    status: 'success',
    data: { review },
  });
});

// Hide review (soft delete by setting status to rejected)
exports.hideReview = catchAsync(async (req, res, next) => {
  const review = await Review.findById(req.params.id);

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  review.status = 'rejected';
  review.moderationNotes = req.body.moderationNotes || 'Hidden by admin';
  await review.save();

  // Recalculate product ratings
  await Review.calcAverageRatings(review.product);

  res.status(200).json({
    status: 'success',
    data: { review },
  });
});

// Seller reply to review
exports.replyToReview = catchAsync(async (req, res, next) => {
  const { reply } = req.body;
  const review = await Review.findById(req.params.id).populate('product');

  if (!review) {
    return next(new AppError('Review not found', 404));
  }

  if (!reply || reply.trim().length === 0) {
    return next(new AppError('Reply cannot be empty', 400));
  }

  // SECURITY FIX #10: Sanitize seller reply to prevent XSS
  const { sanitizeText } = require('../../utils/helpers/sanitizeUserContent');
  const sanitizedReply = sanitizeText(reply);
  if (!sanitizedReply || sanitizedReply.trim().length === 0) {
    return next(new AppError('Reply cannot be empty', 400));
  }

  // Check if user is the seller of the product
  const product = await Product.findById(review.product).populate('seller');
  if (!product || !product.seller) {
    return next(new AppError('Product or seller not found', 404));
  }

  if (product.seller._id.toString() !== req.user.id && req.user.role !== 'admin') {
    return next(new AppError('Only the product seller can reply to reviews', 403));
  }

  review.sellerReply = {
    reply: sanitizedReply.trim(), // SECURITY FIX #10: Use sanitized reply
    repliedAt: new Date(),
    repliedBy: product.seller._id,
  };
  await review.save();

  res.status(200).json({
    status: 'success',
    data: { review },
  });
});

// Get reviews for seller's products
exports.getSellerReviews = catchAsync(async (req, res, next) => {
  // Get seller ID from authenticated user
  const sellerId = req.user.id;

  // Find all products belonging to this seller
  const sellerProducts = await Product.find({ seller: sellerId }).select('_id');
  const productIds = sellerProducts.map(p => p._id);

  if (productIds.length === 0) {
    return res.status(200).json({
      status: 'success',
      results: [],
      meta: {
        total: 0,
        page: 1,
        limit: 50,
        totalPages: 0,
      },
    });
  }

  // Build filter for reviews
  let filter = { product: { $in: productIds } };

  // Add status filter if provided
  if (req.query.status && req.query.status !== 'all') {
    filter.status = req.query.status;
  }

  // Add rating filter if provided
  if (req.query.rating) {
    filter.rating = parseInt(req.query.rating);
  }

  // Build query
  let query = Review.find(filter)
    .populate({ path: 'product', select: 'name imageCover' })
    .populate({ path: 'user', select: 'name photo' })
    .populate({ path: 'order', select: 'orderNumber' })
    .populate({ path: 'sellerReply.repliedBy', select: 'shopName' })
    .sort({ createdAt: -1 });

  // Apply pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  const reviews = await query.skip(skip).limit(limit);
  const total = await Review.countDocuments(filter);

  res.status(200).json({
    status: 'success',
    results: reviews,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
});
