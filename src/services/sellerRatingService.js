/**
 * System-Derived Seller Rating Service
 * 
 * CRITICAL: Seller ratings MUST be system-derived, NOT from direct user reviews.
 * This ensures fair, objective ratings based on actual performance metrics.
 * 
 * Formula:
 * sellerRating = (avgProductRating * 0.6) + 
 *                (orderCompletionScore * 0.2) + 
 *                (deliveryScore * 0.1) + 
 *                (disputeScore * 0.1)
 * 
 * Updates on:
 * - Order completion
 * - Review creation (product reviews)
 * - Dispute resolution
 */

const Seller = require('../models/user/sellerModel');
const Product = require('../models/product/productModel');
const Review = require('../models/product/reviewModel');
const SellerOrder = require('../models/order/sellerOrderModel');
const RefundRequest = require('../models/refund/refundRequestModel');
const mongoose = require('mongoose');

/**
 * Calculate system-derived seller rating
 * @param {String} sellerId - Seller ID
 * @returns {Object} { rating, breakdown }
 */
exports.calculateSellerRating = async (sellerId) => {
  try {
    // 1. Average Product Rating (60% weight)
    const avgProductRating = await calculateAverageProductRating(sellerId);
    const productRatingScore = (avgProductRating / 5) * 100; // Convert to 0-100 scale

    // 2. Order Completion Rate (20% weight)
    const orderCompletionScore = await calculateOrderCompletionRate(sellerId);

    // 3. Delivery Performance (10% weight)
    const deliveryScore = await calculateDeliveryPerformance(sellerId);

    // 4. Dispute/Return Rate (10% weight) - Lower is better
    const disputeScore = await calculateDisputeScore(sellerId);

    // Calculate weighted rating
    const sellerRating = (
      productRatingScore * 0.6 +
      orderCompletionScore * 0.2 +
      deliveryScore * 0.1 +
      disputeScore * 0.1
    );

    // Convert back to 0-5 scale
    const ratingOutOf5 = (sellerRating / 100) * 5;

    const breakdown = {
      productRating: {
        value: avgProductRating,
        score: productRatingScore,
        weight: 0.6,
      },
      orderCompletion: {
        score: orderCompletionScore,
        weight: 0.2,
      },
      delivery: {
        score: deliveryScore,
        weight: 0.1,
      },
      dispute: {
        score: disputeScore,
        weight: 0.1,
      },
    };

    return {
      rating: Math.round(ratingOutOf5 * 10) / 10, // Round to 1 decimal
      ratingPercentage: Math.round(sellerRating * 10) / 10,
      breakdown,
    };
  } catch (error) {
    console.error(`[Seller Rating] Error calculating rating for seller ${sellerId}:`, error);
    // Return default rating on error
    return {
      rating: 0,
      ratingPercentage: 0,
      breakdown: {},
    };
  }
};

/**
 * Calculate average product rating from approved reviews
 */
async function calculateAverageProductRating(sellerId) {
  try {
    // Get all products for this seller
    const sellerProducts = await Product.find({ seller: sellerId }).select('_id');
    const productIds = sellerProducts.map(p => p._id);

    if (productIds.length === 0) {
      return 5; // Default to 5 if no products
    }

    // Get average rating from approved reviews
    const stats = await Review.aggregate([
      {
        $match: {
          product: { $in: productIds },
          status: 'approved', // Only count approved reviews
        },
      },
      {
        $group: {
          _id: null,
          avgRating: { $avg: '$rating' },
          count: { $sum: 1 },
        },
      },
    ]);

    if (stats.length > 0 && stats[0].count > 0) {
      return Math.round(stats[0].avgRating * 10) / 10;
    }

    return 5; // Default to 5 if no reviews
  } catch (error) {
    console.error('[Seller Rating] Error calculating product rating:', error);
    return 5;
  }
}

/**
 * Calculate order completion rate
 * Completion rate = (completed orders / total orders) * 100
 */
async function calculateOrderCompletionRate(sellerId) {
  try {
    const totalOrders = await SellerOrder.countDocuments({
      seller: sellerId,
      status: { $nin: ['cancelled', 'refunded'] }, // Exclude cancelled/refunded
    });

    if (totalOrders === 0) {
      return 100; // Default to 100% if no orders
    }

    const completedOrders = await SellerOrder.countDocuments({
      seller: sellerId,
      status: 'delivered',
    });

    const completionRate = (completedOrders / totalOrders) * 100;
    return Math.round(completionRate * 10) / 10;
  } catch (error) {
    console.error('[Seller Rating] Error calculating order completion rate:', error);
    return 100;
  }
}

/**
 * Calculate delivery performance score
 * Based on on-time delivery rate
 */
async function calculateDeliveryPerformance(sellerId) {
  try {
    // Get delivered orders
    const deliveredOrders = await SellerOrder.countDocuments({
      seller: sellerId,
      status: 'delivered',
    });

    if (deliveredOrders === 0) {
      return 100; // Default to 100% if no deliveries
    }

    // For now, assume all delivered orders are on-time
    // TODO: Add actual delivery time tracking vs estimated delivery time
    // This would require deliveryEstimate and actualDeliveryDate fields
    const onTimeDeliveries = deliveredOrders; // Simplified - all delivered = on-time

    const onTimeRate = (onTimeDeliveries / deliveredOrders) * 100;
    return Math.round(onTimeRate * 10) / 10;
  } catch (error) {
    console.error('[Seller Rating] Error calculating delivery performance:', error);
    return 100;
  }
}

/**
 * Calculate dispute/return score (lower is better)
 * Score = 100 - (dispute rate * 100)
 * Higher dispute rate = lower score
 */
async function calculateDisputeScore(sellerId) {
  try {
    const totalOrders = await SellerOrder.countDocuments({
      seller: sellerId,
    });

    if (totalOrders === 0) {
      return 100; // Default to 100% if no orders
    }

    // Count disputes/refunds
    const disputes = await RefundRequest.countDocuments({
      seller: sellerId,
      status: { $in: ['approved', 'seller_review', 'admin_review'] },
    });

    const disputeRate = (disputes / totalOrders) * 100;
    // Convert to score: 100 - dispute rate (lower dispute = higher score)
    const score = Math.max(0, 100 - disputeRate);
    return Math.round(score * 10) / 10;
  } catch (error) {
    console.error('[Seller Rating] Error calculating dispute score:', error);
    return 100;
  }
}

/**
 * Update seller rating in database
 * @param {String} sellerId - Seller ID
 */
exports.updateSellerRating = async (sellerId) => {
  try {
    const ratingData = await exports.calculateSellerRating(sellerId);

    await Seller.findByIdAndUpdate(sellerId, {
      'ratings.average': ratingData.rating,
      'ratings.breakdown': ratingData.breakdown,
      'ratings.lastUpdated': new Date(),
    });

    return ratingData;
  } catch (error) {
    console.error(`[Seller Rating] Error updating rating for seller ${sellerId}:`, error);
    throw error;
  }
};

/**
 * Recalculate rating for all sellers (admin function)
 */
exports.recalculateAllSellerRatings = async () => {
  try {
    const sellers = await Seller.find({}).select('_id');
    const results = [];

    for (const seller of sellers) {
      try {
        const ratingData = await exports.updateSellerRating(seller._id);
        results.push({
          sellerId: seller._id,
          rating: ratingData.rating,
          success: true,
        });
      } catch (error) {
        results.push({
          sellerId: seller._id,
          error: error.message,
          success: false,
        });
      }
    }

    return results;
  } catch (error) {
    console.error('[Seller Rating] Error recalculating all ratings:', error);
    throw error;
  }
};

module.exports = exports;

