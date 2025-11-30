/**
 * Calculate shipping fee based on zone, weight, shipping type, and fragile flag
 * @param {Object} zone - ShippingZone document
 * @param {Number} weight - Weight in kg
 * @param {String} shippingType - 'standard', 'same_day', or 'express'
 * @param {Boolean} fragile - Whether item is fragile (adds surcharge)
 * @returns {Number} Calculated shipping fee (rounded up)
 */
function calcShipping(zone, weight, shippingType = 'standard', fragile = false) {
  if (!zone) {
    throw new Error('Zone is required');
  }

  // Ensure minimum weight of 0.5kg to avoid showing just baseRate
  const actualWeight = weight && weight > 0 ? weight : 0.5;

  // Base calculation: baseRate + (perKgRate * weight)
  let fee = zone.baseRate + (zone.perKgRate * actualWeight);

  // Apply multipliers based on shipping type
  if (shippingType === 'same_day') {
    fee *= zone.sameDayMultiplier;
  } else if (shippingType === 'express') {
    fee *= zone.expressMultiplier;
  }
  // 'standard' uses base rate (multiplier = 1.0)

  // Add fragile surcharge if applicable
  if (fragile && zone.fragileSurcharge) {
    fee += zone.fragileSurcharge;
  }

  // Round up to nearest whole number
  return Math.ceil(fee);
}

/**
 * Calculate shipping fee with breakdown
 * @param {Object} zone - ShippingZone document
 * @param {Number} weight - Weight in kg
 * @param {String} shippingType - 'standard', 'same_day', or 'express'
 * @param {Boolean} fragile - Whether item is fragile (adds surcharge)
 * @returns {Object} { fee, breakdown }
 */
function calcShippingWithBreakdown(zone, weight, shippingType = 'standard', fragile = false) {
  // Ensure minimum weight of 0.5kg to avoid showing just baseRate
  const actualWeight = weight && weight > 0 ? weight : 0.5;
  
  const baseFee = zone.baseRate;
  const weightFee = zone.perKgRate * actualWeight;
  const subtotal = baseFee + weightFee;

  let multiplier = 1.0;
  if (shippingType === 'same_day') {
    multiplier = zone.sameDayMultiplier;
  } else if (shippingType === 'express') {
    multiplier = zone.expressMultiplier;
  }

  const feeAfterMultiplier = subtotal * multiplier;
  const fragileSurcharge = fragile && zone.fragileSurcharge ? zone.fragileSurcharge : 0;
  const finalFee = Math.ceil(feeAfterMultiplier + fragileSurcharge);

  return {
    fee: finalFee,
    breakdown: {
      baseRate: baseFee,
      weightFee: weightFee,
      subtotal: subtotal,
      multiplier: multiplier,
      fragileSurcharge: fragileSurcharge,
      shippingType: shippingType,
      estimatedDays: zone.estimatedDays,
    },
  };
}

module.exports = {
  calcShipping,
  calcShippingWithBreakdown,
};

