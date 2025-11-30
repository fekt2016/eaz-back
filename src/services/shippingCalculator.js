const ShippingRate = require('../models/shipping/shippingRateModel');
const { detectZone, isNightTime, isWeekend } = require('./zoneService');
const { getDistanceKm } = require('./distanceService');
const { getWarehouseLocation } = require('../config/warehouseConfig');

/**
 * Shipping Calculator Service
 * Calculates shipping fees based on distance, weight, and shipping type
 * 
 * IMPORTANT: The warehouse origin is FIXED and always uses WAREHOUSE_LOCATION from config.
 * Only the customer's destination address is geocoded. The warehouse location never changes.
 */

/**
 * Calculate shipping fee using distance-based zone detection
 * 
 * FIXED ORIGIN: Always uses WAREHOUSE_LOCATION as the origin point.
 * Only the destination (customer address) is geocoded.
 * 
 * @param {Object} params
 * @param {Number} params.distanceKm - Distance in kilometers (optional if destination provided)
 * @param {Number} params.destLat - Destination latitude (required if distanceKm not provided)
 * @param {Number} params.destLng - Destination longitude (required if distanceKm not provided)
 * @param {String} params.destinationAddress - Destination address string (optional, for geocoding)
 * @param {Number} params.weight - Weight in kg
 * @param {String} params.type - Shipping type: 'standard', 'same_day', or 'express'
 * @param {Boolean} params.fragile - Whether item is fragile (default: false)
 * @param {Date|String} params.orderTime - Order timestamp for weekend/night detection (default: now)
 * @returns {Promise<Object>} { zone, distanceKm, fee, estimatedDelivery, baseFee, multiplier, breakdown }
 */
async function calculateShipping({ 
  distanceKm, 
  destLat, 
  destLng, 
  destinationAddress,
  weight, 
  type = 'standard',
  fragile = false,
  orderTime = new Date()
}) {
  // Validate weight
  if (!weight || weight <= 0) {
    throw new Error('Valid weight is required');
  }

  // Validate shipping type
  const validTypes = ['standard', 'same_day', 'express'];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid shipping type. Must be one of: ${validTypes.join(', ')}`);
  }

  // FIXED ORIGIN: Always use warehouse location - never geocode or change this
  const warehouseLocation = await getWarehouseLocation();
  const originLat = warehouseLocation.lat;
  const originLng = warehouseLocation.lng;

  // Calculate distance if not provided
  let calculatedDistanceKm = distanceKm;
  if (!calculatedDistanceKm) {
    let finalDestLat = destLat;
    let finalDestLng = destLng;
    
    // If address string provided, geocode it first to get coordinates
    if (destinationAddress && (!finalDestLat || !finalDestLng)) {
      const { geocodeAddress } = require('./googleMapsService');
      const geocodeResult = await geocodeAddress(destinationAddress);
      if (!geocodeResult || !geocodeResult.lat || !geocodeResult.lng) {
        throw new Error('Failed to geocode destination address');
      }
      finalDestLat = geocodeResult.lat;
      finalDestLng = geocodeResult.lng;
    }
    
    // Validate we have destination coordinates
    if (!finalDestLat || !finalDestLng) {
      throw new Error('Either distanceKm, destination coordinates (destLat/destLng), or destinationAddress must be provided');
    }
    
    // Calculate distance: FIXED WAREHOUSE → customer destination
    const distanceResult = await getDistanceKm(originLat, originLng, finalDestLat, finalDestLng);
    calculatedDistanceKm = distanceResult.distanceKm;
  }

  // Detect zone from distance
  const zone = detectZone(calculatedDistanceKm);

  // Calculate shipping fee using ShippingRate model
  const result = await ShippingRate.calculateFee(weight, type, zone);

  // Get the rate document to access surcharges
  const rate = await ShippingRate.findRate(weight, 'standard', zone);
  
  // Parse orderTime if it's a string
  const orderDate = orderTime instanceof Date ? orderTime : new Date(orderTime);
  
  // Calculate surcharges
  const fragileSurcharge = fragile ? (rate?.fragileSurcharge || 0) : 0;
  const weekendSurcharge = isWeekend(orderDate) ? (rate?.weekendSurcharge || 0) : 0;
  const nightSurcharge = isNightTime(orderDate) ? (rate?.nightSurcharge || 0) : 0;
  
  // Calculate total fee: base cost * multiplier + surcharges
  const totalFee = result.fee + fragileSurcharge + weekendSurcharge + nightSurcharge;

  // Determine estimated delivery based on type and distance
  let estimatedDelivery = result.estimatedDays;
  if (type === 'same_day') {
    estimatedDelivery = 'Arrives Today';
  } else if (type === 'express') {
    estimatedDelivery = '1-2 Business Days';
  }

  return {
    zone,
    distanceKm: calculatedDistanceKm,
    fee: Math.round(totalFee * 100) / 100,
    estimatedDelivery,
    baseFee: result.baseFee,
    perKgFee: result.perKgFee,
    weightAddOn: result.weightAddOn,
    multiplier: result.multiplier,
    baseCost: result.baseCost,
    weight,
    shippingType: type,
    breakdown: {
      baseFee: result.baseFee,
      weightAddOn: result.weightAddOn || 0,
      fragileSurcharge,
      weekendSurcharge,
      nightSurcharge,
      subtotal: result.fee,
      total: Math.round(totalFee * 100) / 100,
    },
  };
}

module.exports = {
  calculateShipping,
};

