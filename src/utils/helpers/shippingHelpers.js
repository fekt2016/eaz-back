/**
 * Shipping Helper Utilities
 * Functions for weight calculation, zone detection, and delivery estimates
 */

const ShippingConfig = require('../../models/shipping/shippingConfigModel');
const Product = require('../../models/product/productModel');

/**
 * Convert weight to kilograms
 * @param {Number} weight - Weight value
 * @param {String} unit - Weight unit (g, kg, lb, oz)
 * @returns {Number} Weight in kilograms
 */
exports.convertToKg = (weight, unit = 'kg') => {
  if (!weight || weight === 0) return 0;
  
  const conversions = {
    g: weight / 1000,
    kg: weight,
    lb: weight * 0.453592,
    oz: weight * 0.0283495,
  };
  
  return conversions[unit] || weight;
};

/**
 * Calculate total weight of cart items
 * @param {Array} items - Cart items with product references
 * @returns {Promise<Number>} Total weight in kg
 */
exports.calculateCartWeight = async (items) => {
  if (!items || items.length === 0) return 0;
  
  let totalWeight = 0;
  
  for (const item of items) {
    const productId = item.product?._id || item.product;
    const variantId = item.variant;
    
    if (!productId) continue;
    
    const product = await Product.findById(productId).select('variants specifications shipping');
    
    if (!product) continue;
    
    let itemWeight = 0;
    let weightUnit = 'kg';
    
    // Try to get weight from variant first
    if (variantId && product.variants) {
      const variant = product.variants.id(variantId);
      if (variant?.weight?.value) {
        itemWeight = variant.weight.value;
        weightUnit = variant.weight.unit || 'kg';
      }
    }
    
    // Fallback to product-level weight
    if (!itemWeight && product.specifications?.weight?.value) {
      itemWeight = product.specifications.weight.value;
      weightUnit = product.specifications.weight.unit || 'kg';
    } else if (!itemWeight && product.shipping?.weight?.value) {
      itemWeight = product.shipping.weight.value;
      weightUnit = product.shipping.weight.unit || 'kg';
    }
    
    // Convert to kg and multiply by quantity
    const weightInKg = this.convertToKg(itemWeight, weightUnit);
    totalWeight += weightInKg * (item.quantity || 1);
  }
  
  return Math.max(0, totalWeight);
};

/**
 * Detect delivery zone based on city
 * @param {String} city - Buyer's city
 * @param {Object} config - ShippingConfig document
 * @returns {Object} Zone object with zoneId and name
 */
exports.detectZone = (city, config) => {
  if (!city || !config) {
    return { zoneId: 'C', name: 'Nationwide' };
  }
  
  const normalizedCity = city.toUpperCase().trim();
  const zone = config.getZoneByCity(normalizedCity);
  
  return {
    zoneId: zone.zoneId,
    name: zone.name,
  };
};

/**
 * Check if same-day delivery is available based on cut-off time
 * @param {String|Date} orderTime - Order time (ISO string or Date)
 * @param {String} cutOffTime - Cut-off time in HH:MM format (24-hour)
 * @returns {Boolean} True if same-day delivery is available
 */
exports.isSameDayAvailable = (orderTime, cutOffTime = '15:00') => {
  if (!orderTime) return false;
  
  const orderDate = new Date(orderTime);
  const now = new Date();
  
  // If order time is in the future, use current time
  const checkTime = orderDate > now ? now : orderDate;
  
  // Parse cut-off time
  const [cutOffHour, cutOffMinute] = cutOffTime.split(':').map(Number);
  const cutOffDate = new Date(checkTime);
  cutOffDate.setHours(cutOffHour, cutOffMinute, 0, 0);
  
  // Check if current time is before cut-off
  return checkTime < cutOffDate;
};

/**
 * Calculate delivery estimate date
 * @param {String} shippingType - 'same_day' or 'standard'
 * @param {Date} orderDate - Order date
 * @param {Object} config - ShippingConfig with standardDeliveryDays
 * @returns {String} Delivery estimate text
 */
exports.calculateDeliveryEstimate = (shippingType, orderDate, config) => {
  const order = new Date(orderDate);
  
  if (shippingType === 'same_day') {
    return 'Arrives Today';
  }
  
  // Standard delivery
  const minDays = config?.standardDeliveryDays?.min || 1;
  const maxDays = config?.standardDeliveryDays?.max || 3;
  
  if (minDays === maxDays) {
    return `${minDays} Business Day${minDays > 1 ? 's' : ''}`;
  }
  
  return `${minDays}-${maxDays} Business Days`;
};

/**
 * Calculate shipping fee
 * @param {Object} params - Calculation parameters
 * @param {Number} params.weight - Total weight in kg
 * @param {String} params.zoneId - Zone ID (A, B, or C)
 * @param {String} params.shippingType - 'same_day' or 'standard'
 * @param {Object} params.config - ShippingConfig document
 * @returns {Object} Shipping calculation result
 */
exports.calculateShippingFee = ({ weight, zoneId, shippingType, config }) => {
  if (!config || !zoneId) {
    throw new Error('Shipping config and zone are required');
  }
  
  // Get zone
  const zone = config.zones.find((z) => z.zoneId === zoneId);
  if (!zone) {
    throw new Error(`Zone ${zoneId} not found in config`);
  }
  
  // Get base rate based on shipping type
  const baseRate = shippingType === 'same_day' 
    ? zone.baseSameDayRate 
    : zone.baseStandardRate;
  
  // Get weight multiplier
  const weightMultiplier = config.getWeightMultiplier(weight);
  
  // Calculate final fee
  const shippingFee = baseRate * weightMultiplier;
  
  return {
    baseRate,
    weightMultiplier,
    weight,
    zoneId,
    zoneName: zone.name,
    shippingFee: Math.round(shippingFee * 100) / 100, // Round to 2 decimal places
  };
};

/**
 * Get active shipping config
 * @returns {Promise<Object>} ShippingConfig document
 */
exports.getActiveShippingConfig = async () => {
  let config = await ShippingConfig.getActiveConfig('standard');
  
  if (!config) {
    config = await ShippingConfig.getOrCreateDefault();
  }
  
  return config;
};

