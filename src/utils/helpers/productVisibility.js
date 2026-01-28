/**
 * Product Visibility Helper
 * 
 * Ensures only approved and active products are visible to buyers.
 * 
 * Rules:
 * - Products are visible to buyers if:
 *   1. product.status === "active" or "out_of_stock"
 *   2. product.moderationStatus === "approved"
 *   3. product.isVisible === true (automatically set when approved)
 *   4. product is not deleted
 * 
 * Note: Seller verification is NOT required for products to be visible.
 * Once a product is approved by admin, it will be visible to buyers.
 * 
 * - Sellers can ALWAYS see their own products (regardless of moderation status)
 * - Admins can ALWAYS see all products
 */

const Product = require('../../models/product/productModel');
const Seller = require('../../models/user/sellerModel');

/**
 * Build a buyer-safe query filter
 * Excludes products from unverified sellers
 * 
 * @param {Object} baseFilter - Base filter object (e.g., category, price range)
 * @param {Object} options - Options object
 * @param {Object} options.user - Current user (req.user)
 * @param {Boolean} options.isAdmin - Whether user is admin
 * @param {Boolean} options.isSeller - Whether user is seller
 * @returns {Object} MongoDB query filter
 */
exports.buildBuyerSafeQuery = (baseFilter = {}, options = {}) => {
  const { user, isAdmin = false, isSeller = false } = options;
  
  // Admins can see all products
  if (isAdmin) {
    return baseFilter;
  }
  
  // Sellers can see their own products (regardless of verification)
  // But for buyer-facing queries, we still filter by visibility
  if (isSeller && user?.id) {
    // For seller's own products, don't filter by visibility
    // This is handled in the controller logic
    return baseFilter;
  }
  
  // For buyers/public: Only show visible products
  // isVisible is automatically set based on:
  // - seller.verificationStatus === 'verified'
  // - product.status === 'active'
  // - product.moderationStatus === 'approved'
  // - product.isDeleted === false (exclude archived products)
  // - product.isDeletedByAdmin === false (exclude admin-deleted products)
  // - product.isDeletedBySeller === false (exclude seller-deleted products)
  
  // CRITICAL: For buyer queries, we need to ensure products are:
  // 1. Approved by admin (moderationStatus: 'approved')
  // 2. Active (status: 'active' or 'out_of_stock')
  // 3. Not deleted
  // 
  // NOTE: Seller verification is NOT required - approved products from any seller are visible
  // NOTE: We don't check isVisible anymore since existing products might have it set to false
  //       from when seller verification was required. We'll rely on moderationStatus and status.
  
  return {
    ...baseFilter,
    // Core requirements - these are the only checks we need
    moderationStatus: 'approved', // Only approved products
    status: { $in: ['active', 'out_of_stock'] }, // Only active products
    // Deletion filters
    isDeleted: { $ne: true },
    isDeletedByAdmin: { $ne: true },
    isDeletedBySeller: { $ne: true },
  };
};

/**
 * Update product visibility for all products of a seller
 * Called when seller verification status changes
 * 
 * @param {String} sellerId - Seller ID
 * @param {String} verificationStatus - New verification status ('verified', 'pending', 'rejected')
 * @returns {Promise<Object>} Update result
 */
exports.updateSellerProductsVisibility = async (sellerId, verificationStatus) => {
  try {
    const isVerified = verificationStatus === 'verified';
    
    // Find all products for this seller
    const products = await Product.find({ seller: sellerId });
    
    if (products.length === 0) {
      return { updated: 0, message: 'No products found for seller' };
    }
    
    // Update visibility for each product
    // Product is visible if: product active AND moderation approved
    // NOTE: Seller verification is NOT required
    const updatePromises = products.map(async (product) => {
      const shouldBeVisible = 
        product.status === 'active' &&
        product.moderationStatus === 'approved';
      
      if (product.isVisible !== shouldBeVisible) {
        return Product.findByIdAndUpdate(
          product._id,
          { isVisible: shouldBeVisible },
          { runValidators: false }
        );
      }
      return null;
    });
    
    const results = await Promise.all(updatePromises);
    const updated = results.filter(r => r !== null).length;
    
    console.log(`[Product Visibility] Updated ${updated} products for seller ${sellerId} (verification: ${verificationStatus})`);
    
    return {
      updated,
      total: products.length,
      message: `Updated visibility for ${updated} products`,
    };
  } catch (error) {
    console.error('[Product Visibility] Error updating seller products:', error);
    throw error;
  }
};

/**
 * Check if a product should be visible to buyers
 * 
 * @param {Object} product - Product document
 * @param {Object} seller - Seller document (optional, will fetch if not provided)
 * @returns {Promise<Boolean>} Whether product is visible
 */
exports.isProductVisibleToBuyers = async (product, seller = null) => {
  try {
    // If seller not provided, fetch it
    if (!seller && product.seller) {
      seller = await Seller.findById(product.seller);
    }
    
    if (!seller) {
      return false;
    }
    
    // Product is visible if all conditions are met:
    // NOTE: Seller verification is NOT required - only product approval and status matter
    return (
      product.status === 'active' &&
      product.moderationStatus === 'approved' &&
      !product.isDeleted &&
      !product.isDeletedByAdmin &&
      !product.isDeletedBySeller
    );
  } catch (error) {
    console.error('[Product Visibility] Error checking visibility:', error);
    return false;
  }
};

