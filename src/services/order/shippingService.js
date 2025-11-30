/**
 * Shipping Service
 * Handles shipping cost calculations, tracking number generation, and delivery agent assignment
 */

/**
 * Calculate shipping cost based on items, seller location, and delivery address
 * @param {Array} items - Order items
 * @param {Object} sellerLocation - Seller's location { region, district }
 * @param {Object} deliveryAddress - Buyer's delivery address { region, district }
 * @returns {Object} Shipping information with costs and estimated days
 */
exports.calculateShippingCost = (items, sellerLocation, deliveryAddress) => {
  // Base shipping cost (in GHS)
  const baseCost = 10;

  // Calculate weight-based cost (assuming average weight per item)
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const weightCost = totalItems * 2; // 2 GHS per item

  // Distance-based cost (same region = lower cost)
  let distanceMultiplier = 1;
  if (sellerLocation.region !== deliveryAddress.region) {
    distanceMultiplier = 1.5; // Inter-regional shipping
  }

  // Calculate total base cost
  const totalBaseCost = (baseCost + weightCost) * distanceMultiplier;

  // Company fee (10% of base cost)
  const companyFee = totalBaseCost * 0.1;

  // Buyer charge (base cost + company fee)
  const buyerCharge = totalBaseCost + companyFee;

  // Seller charge (optional - if seller covers part of shipping)
  const sellerCharge = 0; // Can be configured per seller

  // Estimated delivery days
  let estimatedDays = 3; // Default
  if (sellerLocation.region === deliveryAddress.region) {
    estimatedDays = 2; // Same region = faster
  } else {
    estimatedDays = 5; // Different region = slower
  }

  return {
    baseCost: totalBaseCost,
    buyerCharge: Math.round(buyerCharge * 100) / 100, // Round to 2 decimals
    sellerCharge,
    companyFee: Math.round(companyFee * 100) / 100,
    estimatedDays,
  };
};

/**
 * Generate a unique tracking number
 * @returns {String} Tracking number in format: EAZ-YYYYMMDD-XXXXXX
 */
exports.generateTrackingNumber = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  // Generate 6 random digits
  const random = Math.floor(100000 + Math.random() * 900000).toString();

  return `EAZ-${year}${month}${day}-${random}`;
};

/**
 * Assign a delivery agent based on district
 * @param {String} district - Delivery district
 * @returns {String} Delivery agent ID or name
 */
exports.assignDeliveryAgent = (district) => {
  // In a real app, this would query a database of available agents
  // For now, return a placeholder based on district
  const agents = {
    'Accra Metropolitan': 'AGENT-001',
    'Kumasi Metropolitan': 'AGENT-002',
    'Tamale Metropolitan': 'AGENT-003',
    // Add more districts as needed
  };

  return agents[district] || 'AGENT-DEFAULT';
};

