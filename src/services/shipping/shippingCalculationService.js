const Product = require('../../models/product/productModel');
const Seller = require('../../models/user/sellerModel');
const PickupCenter = require('../../models/shipping/pickupCenterModel');
const CacheService = require('./shippingCacheService');
const logger = require('../../utils/logger');
const { getZoneFromNeighborhoodId } = require('../../utils/getZoneFromNeighborhood');

const EAZSHOP_SELLER_ID = '6970b22eaba06cadfd4b8035';

/**
 * Get products populated with categories for tier comparison
 */
async function getProductsWithCategories(items) {
  const productIds = items.map(item => item.productId).filter(Boolean);
  return Product.find({ _id: { $in: productIds } })
    .populate('parentCategory')
    .populate('subCategory')
    .select('shipping specifications weight parentCategory subCategory isEazShopProduct seller name shippingType');
}

/**
 * Unified Shipping Calculation Logc
 * Computes fee based on Zone rates * Tier Multipliers + Surcharges
 */
async function calculateUnifiedShipping(items, buyerCity, buyerNeighborhoodId, shippingType = 'standard') {
  let zone;

  // 1. Try to get zone from neighborhood exact match
  if (buyerNeighborhoodId) {
    try {
      const zoneData = await getZoneFromNeighborhoodId(buyerNeighborhoodId);
      if (zoneData && zoneData.name) {
        zone = await CacheService.getZone(zoneData.name);
      }
    } catch (e) {
      logger.warn('[UnifiedShipping] neighborhood lookup failed:', e.message);
    }
  }

  // 2. Fallback to city defaults if neighborhood doesn't resolve a zone
  if (!zone) {
    const defaultZoneName = (buyerCity && buyerCity.toUpperCase() === 'TEMA') ? 'B' : 'A';
    zone = await CacheService.getZone(defaultZoneName);
  }

  if (!zone) {
    logger.error('[UnifiedShipping] Critical: No valid timezone found even after fallback.');
    throw new Error('Could not resolve shipping zone. Service unavailable.');
  }

  // 3. Get Products and Categories for highest tier
  const products = await getProductsWithCategories(items);
  let maxTier = await CacheService.getDefaultTier() || { multiplier: 1, name: 'Fallback', fragileSurcharge: 0, weightThreshold: 5, weightSurchargePerKg: 2 };
  let totalWeight = 0;

  for (const product of products) {
    const itemReq = items.find(i => i.productId.toString() === product._id.toString());
    const qty = itemReq ? itemReq.quantity : 1;

    // Weight resolution (backwards compatibility with existing old formats)
    let itemWeight = 0;
    if (product.shipping && product.shipping.weight && product.shipping.weight.value) {
      itemWeight = product.shipping.weight.value;
      if (product.shipping.weight.unit === 'g') itemWeight /= 1000;
      if (product.shipping.weight.unit === 'lb') itemWeight *= 0.453592;
    } else if (product.specifications && product.specifications.weight && product.specifications.weight.value) {
      itemWeight = product.specifications.weight.value;
    } else if (product.weight) {
      itemWeight = product.weight;
    }

    totalWeight += ((itemWeight || 0.5) * qty); // Default 0.5kg

    // Tier comparison
    if (product.category && product.category.shippingTierId) {
      const productTier = await CacheService.getTier(product.category.shippingTierId);
      if (productTier && productTier.multiplier > maxTier.multiplier) {
        maxTier = productTier;
      }
    }
  }

  // 4. Base Fee Calculation
  let baseFee = (zone.baseRate || 20) * (maxTier.multiplier || 1);

  if (shippingType === 'same_day') {
    baseFee = baseFee * (zone.sameDayMultiplier || 1.2);
  } else if (shippingType === 'express') {
    baseFee = baseFee * (zone.expressMultiplier || 1.4);
  }

  // 5. Weight and Fragile Surcharges
  if (totalWeight > (maxTier.weightThreshold || 5)) {
    const extraWeight = Math.ceil(totalWeight - (maxTier.weightThreshold || 5));
    baseFee += extraWeight * (maxTier.weightSurchargePerKg || 0);
  }

  baseFee += (maxTier.fragileSurcharge || 0);

  return {
    shippingFee: Math.round(baseFee * 100) / 100,
    reason: `zone_${zone.name}_tier_${maxTier.name}`,
    hasHeavyItems: totalWeight > (maxTier.weightThreshold || 5),
    zone: zone.name,
    weight: totalWeight
  };
}


/**
 * Calculate shipping quote for multiple sellers
 * Maintains the exact previous external API response structure.
 */
async function calculateShippingQuote(buyerCity, items, method = 'dispatch', pickupCenterId = null, deliverySpeed = 'standard', neighborhoodId = null) {
  logger.info('[calculateShippingQuote] Unified Engine starting:', { buyerCity, method, deliverySpeed });

  // Group items by sellerId
  const sellerGroups = new Map();
  items.forEach(item => {
    if (!item.sellerId) return;
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

  const shippingTypeMap = deliverySpeed === 'same_day' ? 'same_day' : 'standard';

  if (method === 'pickup_center') {
    if (pickupCenterId) {
      pickupCenter = await PickupCenter.findById(pickupCenterId);
    }
    totalShippingFee = 0;
    dispatchType = null;

    for (const [sellerId, sellerItems] of sellerGroups) {
      const seller = await Seller.findById(sellerId).select('name shopName');
      perSeller.push({
        sellerId,
        sellerName: seller?.shopName || seller?.name || 'Unknown Seller',
        shippingFee: 0,
        reason: 'pickup_center',
        hasHeavyItems: false,
      });
    }
  } else if (method === 'dispatch') {
    // Dispatch groups everything into ONE calculation and zeroes out the per-seller fees
    const allItems = [];
    sellerGroups.forEach((sellerItems) => {
      allItems.push(...sellerItems);
    });

    const unifiedResult = await calculateUnifiedShipping(allItems, buyerCity, neighborhoodId, shippingTypeMap);
    totalShippingFee = unifiedResult.shippingFee;
    dispatchType = 'OFFICIAL_STORE';

    for (const [sellerId] of sellerGroups) {
      const seller = await Seller.findById(sellerId).select('name shopName');
      perSeller.push({
        sellerId,
        sellerName: seller?.shopName || seller?.name || 'Unknown Seller',
        shippingFee: 0,
        reason: unifiedResult.reason,
        hasHeavyItems: unifiedResult.hasHeavyItems,
        weight: unifiedResult.weight,
        zone: unifiedResult.zone,
      });
    }
  } else {
    // Seller delivery calculates individually per seller
    for (const [sellerId, sellerItems] of sellerGroups) {
      const seller = await Seller.findById(sellerId).select('name shopName role');
      const isOfficialStore = sellerId === EAZSHOP_SELLER_ID || seller?.role === 'official_store';

      if (isOfficialStore) {
        throw new Error('Saiisai Official Store does not offer seller delivery. Please use pickup center or Saiisai dispatch.');
      }

      const unifiedResult = await calculateUnifiedShipping(sellerItems, buyerCity, neighborhoodId, shippingTypeMap);

      perSeller.push({
        sellerId,
        sellerName: seller?.shopName || seller?.name || 'Unknown Seller',
        shippingFee: unifiedResult.shippingFee,
        reason: unifiedResult.reason,
        hasHeavyItems: unifiedResult.hasHeavyItems,
      });

      totalShippingFee += unifiedResult.shippingFee;
    }
    dispatchType = 'SELLER';
  }

  return {
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
}

module.exports = {
  // calculateSellerShipping & calculateDispatchShipping exported for backward compatibility 
  // if some very old endpoint hits them directly, though calculateShippingQuote is the main entry.
  calculateUnifiedShipping,
  calculateShippingQuote,
};
