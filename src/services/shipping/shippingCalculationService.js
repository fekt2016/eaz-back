const SellerShippingSettings = require('../../models/shipping/sellerShippingSettingsModel');
const Product = require('../../models/product/productModel');
const Seller = require('../../models/user/sellerModel');
const DispatchFees = require('../../models/shipping/dispatchFeesModel');
const PickupCenter = require('../../models/shipping/pickupCenterModel');
const EazShopShippingFees = require('../../models/shipping/eazshopShippingFeesModel');
const logger = require('../../utils/logger');
const {
  calculateCartWeight,
  detectZone,
  isSameDayAvailable,
  calculateDeliveryEstimate,
  calculateShippingFee,
  getActiveShippingConfig,
} = require('../../utils/helpers/shippingHelpers');

// EazShop Seller ID constant
const EAZSHOP_SELLER_ID = '000000000000000000000001';

/**
 * Calculate shipping fee for a group of items from the same seller
 * @param {Array} items - Array of items with productId, quantity
 * @param {String} sellerId - Seller ID
 * @param {String} buyerCity - Buyer's city (ACCRA or TEMA)
 * @returns {Object} - { shippingFee, reason, hasHeavyItems }
 */
async function calculateSellerShipping(items, sellerId, buyerCity) {
  // Check if this is EazShop store
  const sellerIdStr = sellerId.toString();
  const isEazShopStore = sellerIdStr === EAZSHOP_SELLER_ID;
  
  // Get all products to check if they are EazShop products
  const productIds = items.map(item => item.productId);
  const products = await Product.find({ _id: { $in: productIds } })
    .select('shippingType isEazShopProduct seller');
  
  // Check if any product is EazShop product
  const hasEazShopProducts = products.some(product => 
    product.isEazShopProduct || product.seller?.toString() === EAZSHOP_SELLER_ID
  );

  // If EazShop store or EazShop products, use EazShop shipping fees
  if (isEazShopStore || hasEazShopProducts) {
    const eazshopFees = await EazShopShippingFees.getOrCreate();
    
    // Get seller's city (default to ACCRA for EazShop)
    let sellerCity = 'ACCRA';
    if (isEazShopStore) {
      const seller = await Seller.findById(sellerId).select('shopAddress location');
      if (seller?.shopAddress?.city) {
        sellerCity = seller.shopAddress.city.toUpperCase();
      } else if (seller?.location) {
        const locationUpper = seller.location.toUpperCase();
        if (locationUpper.includes('ACCRA')) {
          sellerCity = 'ACCRA';
        } else if (locationUpper.includes('TEMA')) {
          sellerCity = 'TEMA';
        }
      }
    } else {
      // For EazShop products, get seller city from products
      const seller = await Seller.findById(products[0]?.seller).select('shopAddress location');
      if (seller?.shopAddress?.city) {
        sellerCity = seller.shopAddress.city.toUpperCase();
      } else if (seller?.location) {
        const locationUpper = seller.location.toUpperCase();
        if (locationUpper.includes('ACCRA')) {
          sellerCity = 'ACCRA';
        } else if (locationUpper.includes('TEMA')) {
          sellerCity = 'TEMA';
        }
      }
    }
    
    // Ensure sellerCity is valid
    if (!['ACCRA', 'TEMA'].includes(sellerCity)) {
      sellerCity = 'ACCRA';
    }

    // Check if any item is heavy
    const hasHeavyItems = products.some(product => product.shippingType === 'heavy');

    let shippingFee;
    let reason;

    if (hasHeavyItems) {
      shippingFee = eazshopFees.heavyItem;
      reason = 'heavyItem';
    } else if (buyerCity.toUpperCase() === sellerCity.toUpperCase()) {
      shippingFee = eazshopFees.sameCity;
      reason = 'sameCity';
    } else {
      shippingFee = eazshopFees.crossCity;
      reason = 'crossCity';
    }

    return {
      shippingFee,
      reason,
      hasHeavyItems,
      sellerCity,
      isEazShop: true,
    };
  }

  // Regular seller shipping calculation
  // Get seller's city from seller model
  const seller = await Seller.findById(sellerId).select('shopAddress location');
  // Try to get city from shopAddress.city, or location, or default to ACCRA
  let sellerCity = 'ACCRA'; // Default
  if (seller?.shopAddress?.city) {
    sellerCity = seller.shopAddress.city.toUpperCase();
  } else if (seller?.location) {
    // Try to extract city from location string
    const locationUpper = seller.location.toUpperCase();
    if (locationUpper.includes('ACCRA')) {
      sellerCity = 'ACCRA';
    } else if (locationUpper.includes('TEMA')) {
      sellerCity = 'TEMA';
    }
  }
  
  // Ensure sellerCity is valid
  if (!['ACCRA', 'TEMA'].includes(sellerCity)) {
    sellerCity = 'ACCRA'; // Default fallback
  }

  // Get seller shipping settings (create default if doesn't exist)
  const shippingSettings = await SellerShippingSettings.getOrCreateDefault(sellerId);

  // Check if any item is heavy
  const hasHeavyItems = products.some(product => product.shippingType === 'heavy');

  let shippingFee;
  let reason;

  if (hasHeavyItems) {
    // Use heavy item shipping fee
    shippingFee = shippingSettings.heavyItemShippingFee;
    reason = 'heavyItem';
  } else if (buyerCity.toUpperCase() === sellerCity.toUpperCase()) {
    // Same city
    shippingFee = shippingSettings.sameCityShippingFee;
    reason = 'sameCity';
  } else {
    // Cross city (Accra <-> Tema)
    shippingFee = shippingSettings.crossCityShippingFee;
    reason = 'crossCity';
  }

  return {
    shippingFee,
    reason,
    hasHeavyItems,
    sellerCity,
    isEazShop: false,
  };
}

/**
 * Calculate shipping fee using EazShop dispatch fees
 * @param {Array} items - Array of items with productId, quantity
 * @param {String} buyerCity - Buyer's city (ACCRA or TEMA)
 * @returns {Object} - { shippingFee, reason, hasHeavyItems }
 */
async function calculateDispatchShipping(items, buyerCity) {
  // Get all products to check shippingType and if they are EazShop products
  const productIds = items.map(item => item.productId);
  const products = await Product.find({ _id: { $in: productIds } })
    .populate('seller', 'shopAddress location role')
    .select('shippingType seller isEazShopProduct');

  // Check if any products are EazShop products
  const hasEazShopProducts = products.some(product => 
    product.isEazShopProduct || 
    product.seller?.role === 'eazshop_store' ||
    product.seller?._id?.toString() === EAZSHOP_SELLER_ID
  );

  // Use EazShop shipping fees if products are EazShop products, otherwise use regular dispatch fees
  let fees;
  if (hasEazShopProducts) {
    fees = await EazShopShippingFees.getOrCreate();
  } else {
    fees = await DispatchFees.getOrCreate();
  }

  // Check if any item is heavy
  const hasHeavyItems = products.some(product => product.shippingType === 'heavy');

  // Get seller cities
  const sellerCities = new Set();
  products.forEach(product => {
    if (product.seller) {
      let sellerCity = 'ACCRA';
      if (product.seller.shopAddress?.city) {
        sellerCity = product.seller.shopAddress.city.toUpperCase();
      } else if (product.seller.location) {
        const locationUpper = product.seller.location.toUpperCase();
        if (locationUpper.includes('ACCRA')) sellerCity = 'ACCRA';
        else if (locationUpper.includes('TEMA')) sellerCity = 'TEMA';
      }
      sellerCities.add(sellerCity);
    }
  });

  // Determine if same city or cross city
  // If all sellers are in the same city as buyer, it's same city
  // Otherwise, it's cross city
  const buyerCityUpper = buyerCity.toUpperCase();
  const isSameCity = sellerCities.size === 1 && sellerCities.has(buyerCityUpper);

  let shippingFee;
  let reason;

  if (hasHeavyItems) {
    shippingFee = fees.heavyItem;
    reason = 'heavyItem';
  } else if (isSameCity) {
    shippingFee = fees.sameCity;
    reason = 'sameCity';
  } else {
    shippingFee = fees.crossCity;
    reason = 'crossCity';
  }

  return {
    shippingFee,
    reason,
    hasHeavyItems,
    dispatchType: 'EAZSHOP',
  };
}

/**
 * Calculate shipping quote for multiple sellers
 * @param {String} buyerCity - Buyer's city (ACCRA or TEMA)
 * @param {Array} items - Array of items with productId, sellerId, quantity
 * @param {String} method - Delivery method: 'pickup_center', 'dispatch', 'seller_delivery'
 * @param {String} pickupCenterId - Pickup center ID (if method is pickup_center)
 * @param {String} deliverySpeed - Delivery speed: 'next_day' or 'same_day' (for dispatch method)
 * @returns {Object} - Shipping quote with per-seller breakdown and total
 */
async function calculateShippingQuote(buyerCity, items, method = 'dispatch', pickupCenterId = null, deliverySpeed = 'standard') {
  logger.info('[calculateShippingQuote] Starting calculation:', {
    buyerCity,
    itemsCount: items.length,
    method,
    pickupCenterId,
  });

  // Validate buyer city
  const validCities = ['ACCRA', 'TEMA'];
  if (!buyerCity || !validCities.includes(buyerCity.toUpperCase())) {
    throw new Error('EazShop currently delivers only in Accra and Tema.');
  }

  // Validate method
  const validMethods = ['pickup_center', 'dispatch', 'seller_delivery'];
  if (!validMethods.includes(method)) {
    throw new Error(`Invalid delivery method. Must be one of: ${validMethods.join(', ')}`);
  }

  // Validate items
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('Items array is required and must not be empty');
  }

  // Group items by sellerId and check for EazShop products
  const sellerGroups = new Map();
  const productIds = items.map(item => item.productId).filter(Boolean);
  
  if (productIds.length === 0) {
    throw new Error('No valid product IDs found in items');
  }

  const products = await Product.find({ _id: { $in: productIds } })
    .select('isEazShopProduct seller')
    .populate('seller', 'role');
  
  if (products.length !== productIds.length) {
    logger.warn(`[calculateShippingQuote] Some products not found. Expected ${productIds.length}, found ${products.length}`);
  }
  
  // Check if cart has EazShop products
  const hasEazShopProducts = products.some(product => 
    product.isEazShopProduct || 
    product.seller?.role === 'eazshop_store' ||
    product.seller?._id?.toString() === EAZSHOP_SELLER_ID
  );
  
  // For EazShop products, only allow pickup_center and dispatch
  if (hasEazShopProducts && method === 'seller_delivery') {
    throw new Error('EazShop products only support pickup center or EazShop dispatch delivery. Seller delivery is not available.');
  }
  
  items.forEach(item => {
    if (!item.sellerId) {
      logger.warn('[calculateShippingQuote] Item missing sellerId:', item);
      return;
    }
    const sellerId = item.sellerId.toString();
    if (!sellerGroups.has(sellerId)) {
      sellerGroups.set(sellerId, []);
    }
    sellerGroups.get(sellerId).push({
      productId: item.productId,
      quantity: item.quantity,
    });
  });

  if (sellerGroups.size === 0) {
    throw new Error('No valid sellers found in items');
  }

  let perSeller = [];
  let totalShippingFee = 0;
  let pickupCenter = null;
  let dispatchType = null;

  if (method === 'pickup_center') {
    // Pickup from center - fee is 0 or small fee (can be configured)
    if (pickupCenterId) {
      pickupCenter = await PickupCenter.findById(pickupCenterId);
      if (!pickupCenter || !pickupCenter.isActive) {
        throw new Error('Pickup center not found or inactive');
      }
    }

    // Pickup is free or minimal fee (e.g., 5 GHS)
    totalShippingFee = 0; // Can be changed to a small fee if needed
    dispatchType = null;

    // Still calculate per-seller for breakdown (all 0 for pickup)
    for (const [sellerId, sellerItems] of sellerGroups) {
      const seller = await Seller.findById(sellerId).select('name shopName');
      const sellerName = seller?.shopName || seller?.name || 'Unknown Seller';

      perSeller.push({
        sellerId,
        sellerName,
        shippingFee: 0,
        reason: 'pickup_center',
        hasHeavyItems: false,
      });
    }
  } else if (method === 'dispatch') {
    // EazShop dispatch rider - use new shipping calculation system if deliverySpeed provided
    const allItems = [];
    sellerGroups.forEach((sellerItems) => {
      allItems.push(...sellerItems);
    });

    // Use new shipping calculation system if deliverySpeed is provided
    if (deliverySpeed && (deliverySpeed === 'same_day' || deliverySpeed === 'standard')) {
      try {
        const config = await getActiveShippingConfig();
        const totalWeight = await calculateCartWeight(allItems);
        const zoneInfo = detectZone(buyerCity, config);
        
        // Determine shipping type based on delivery speed
        const shippingType = deliverySpeed === 'same_day' ? 'same_day' : 'standard';
        
        // Check same-day availability
        if (shippingType === 'same_day') {
          const available = isSameDayAvailable(new Date().toISOString(), config.sameDayCutOff);
          if (!available) {
            throw new Error(`Same-day delivery is only available for orders placed before ${config.sameDayCutOff}. Please select next-day delivery.`);
          }
        }
        
        // Calculate shipping fee using new system
        const calculation = calculateShippingFee({
          weight: totalWeight || 0.5, // Default to 0.5kg if weight is 0
          zoneId: zoneInfo.zoneId,
          shippingType,
          config,
        });
        
        totalShippingFee = calculation.shippingFee;
        dispatchType = 'EAZSHOP';
        
        // For dispatch, we calculate one fee for all items
        for (const [sellerId] of sellerGroups) {
          const seller = await Seller.findById(sellerId).select('name shopName');
          const sellerName = seller?.shopName || seller?.name || 'Unknown Seller';

          perSeller.push({
            sellerId,
            sellerName,
            shippingFee: 0, // Fee is calculated at order level, not per seller
            reason: `dispatch_${shippingType}`,
            hasHeavyItems: false,
            weight: totalWeight,
            zone: zoneInfo.zoneId,
          });
        }
      } catch (error) {
        // Fallback to old system if new system fails
        logger.warn('[calculateShippingQuote] New shipping system failed, falling back to old system:', error.message);
        const dispatchInfo = await calculateDispatchShipping(allItems, buyerCity);
        totalShippingFee = dispatchInfo.shippingFee;
        dispatchType = 'EAZSHOP';

        for (const [sellerId] of sellerGroups) {
          const seller = await Seller.findById(sellerId).select('name shopName');
          const sellerName = seller?.shopName || seller?.name || 'Unknown Seller';

          perSeller.push({
            sellerId,
            sellerName,
            shippingFee: 0,
            reason: dispatchInfo.reason,
            hasHeavyItems: dispatchInfo.hasHeavyItems,
          });
        }
      }
    } else {
      // Use old dispatch calculation system
      const dispatchInfo = await calculateDispatchShipping(allItems, buyerCity);
      totalShippingFee = dispatchInfo.shippingFee;
      dispatchType = 'EAZSHOP';

      // For dispatch, we calculate one fee for all items
      for (const [sellerId] of sellerGroups) {
        const seller = await Seller.findById(sellerId).select('name shopName');
        const sellerName = seller?.shopName || seller?.name || 'Unknown Seller';

        perSeller.push({
          sellerId,
          sellerName,
          shippingFee: 0, // Fee is calculated at order level, not per seller
          reason: dispatchInfo.reason,
          hasHeavyItems: dispatchInfo.hasHeavyItems,
        });
      }
    }
  } else {
    // Seller delivery (default)
    for (const [sellerId, sellerItems] of sellerGroups) {
      const seller = await Seller.findById(sellerId).select('name shopName role');
      const sellerName = seller?.shopName || seller?.name || 'Unknown Seller';
      const isEazShopStore = sellerId === EAZSHOP_SELLER_ID || seller?.role === 'eazshop_store';

      // For EazShop store, seller delivery is NOT allowed
      if (isEazShopStore) {
        throw new Error('EazShop Official Store does not offer seller delivery. Please use pickup center or EazShop dispatch.');
      }

      // Check if seller has delivery available
      const shippingSettings = await SellerShippingSettings.getOrCreateDefault(sellerId);
      if (!shippingSettings.sellerDeliveryAvailable) {
        throw new Error(`Seller ${sellerName} does not offer delivery service`);
      }

      const shippingInfo = await calculateSellerShipping(
        sellerItems,
        sellerId,
        buyerCity
      );

      perSeller.push({
        sellerId,
        sellerName,
        shippingFee: shippingInfo.shippingFee,
        reason: shippingInfo.reason,
        hasHeavyItems: shippingInfo.hasHeavyItems,
        sellerCity: shippingInfo.sellerCity,
        isEazShop: shippingInfo.isEazShop || false,
      });

      totalShippingFee += shippingInfo.shippingFee;
    }
    dispatchType = 'SELLER';
  }

  const result = {
    buyerCity: buyerCity.toUpperCase(),
    deliveryMethod: method,
    perSeller,
    totalShippingFee,
    pickupCenter: pickupCenter ? {
      _id: pickupCenter._id,
      pickupName: pickupCenter.pickupName,
      address: pickupCenter.address,
      city: pickupCenter.city,
      area: pickupCenter.area,
      googleMapLink: pickupCenter.googleMapLink,
      instructions: pickupCenter.instructions,
      openingHours: pickupCenter.openingHours,
    } : null,
    dispatchType,
  };

  logger.info('[calculateShippingQuote] Calculation complete:', {
    totalShippingFee: result.totalShippingFee,
    perSellerCount: result.perSeller.length,
    deliveryMethod: result.deliveryMethod,
  });

  return result;
}

module.exports = {
  calculateSellerShipping,
  calculateDispatchShipping,
  calculateShippingQuote,
};

