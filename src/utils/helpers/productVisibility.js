/**
 * Product Visibility Helper
 * 
 * Centralized logic to determine if a product should be visible to buyers.
 * A product is visible only if it meets all platform requirements.
 */

/**
 * Determine if a product should be visible based on its state and seller state.
 * @param {Object} product - The product document (or object with necessary fields)
 * @param {Object|String} seller - The seller document (or verificationStatus string)
 * @returns {Boolean}
 */
exports.calculateVisibility = (product, seller) => {
  // 1. Basic product state checks
  const isDeleted = product.isDeleted || product.isDeletedByAdmin || product.isDeletedBySeller;
  if (isDeleted) return false;

  const isValidStatus = ['active', 'out_of_stock'].includes(product.status);
  if (!isValidStatus) return false;

  const isApproved = product.moderationStatus === 'approved';
  if (!isApproved) return false;

  // 2. Seller verification check
  // User requested to REMOVE the verification requirement.
  // Products from both verified and unverified sellers should be visible.
  const isSellerVerified = true;

  return isSellerVerified;
};

/**
 * Build a MongoDB query filter that ensures products are safe for buyers to see.
 * This utilizes the `isVisible` field that encapsulates seller verification,
 * product approval, soft delete status, and active status.
 *
 * @param {Object} baseQuery - The existing query filter to append to.
 * @param {Object} options - { user, isAdmin, isSeller }
 * @returns {Object} The updated query
 */
exports.buildBuyerSafeQuery = (baseQuery = {}, options = {}) => {
  const { isAdmin, isSeller, user } = options;

  // Admins can see everything, no need to restrict
  if (isAdmin) {
    return baseQuery;
  }

  // If seller, they can see their own products regardless of visibility,
  // but for other products they only see visible ones.
  if (isSeller && user && (user.id || user._id)) {
    const sellerId = user.id || user._id;
    return {
      ...baseQuery,
      $or: [
        { isVisible: true },
        { seller: sellerId }
      ]
    };
  }

  // Regular buyers only see visible products
  return {
    ...baseQuery,
    isVisible: true
  };
};
