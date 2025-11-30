/**
 * Tax Service - Ghana Revenue Authority (GRA) Tax Calculations
 * 
 * Implements VAT-inclusive pricing system according to Ghana tax rules.
 * All rates are now dynamically loaded from PlatformSettings model.
 */

const PlatformSettings = require('../../models/platform/platformSettingsModel');

// Cache settings to reduce database calls
let cachedSettings = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get platform settings (with caching)
 * @returns {Promise<Object>} Platform settings
 */
async function getSettings() {
  const now = Date.now();
  
  // Return cached settings if still valid
  if (cachedSettings && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedSettings;
  }
  
  // Fetch fresh settings
  const settings = await PlatformSettings.getSettings();
  cachedSettings = settings;
  cacheTimestamp = now;
  
  return settings;
}

/**
 * Clear settings cache (call this when settings are updated)
 */
exports.clearSettingsCache = () => {
  cachedSettings = null;
  cacheTimestamp = null;
};

/**
 * Extract base price and tax components from VAT-inclusive price
 * @param {Number} vatInclusivePrice - Price that includes VAT
 * @param {Object} settings - Optional platform settings (if not provided, will fetch)
 * @returns {Promise<Object>|Object} Tax breakdown
 */
exports.extractTaxFromPrice = async (vatInclusivePrice, settings = null) => {
  if (!vatInclusivePrice || vatInclusivePrice <= 0) {
    return {
      basePrice: 0,
      vat: 0,
      nhil: 0,
      getfund: 0,
      totalVATComponents: 0,
      vatInclusivePrice: 0,
    };
  }

  // Get settings if not provided
  if (!settings) {
    settings = await getSettings();
  }

  const vatRate = settings.vatRate || 0.125;
  const nhilRate = settings.nhilRate || 0.025;
  const getfundRate = settings.getfundRate || 0.025;
  const totalVATRate = vatRate + nhilRate + getfundRate;
  const vatInclusiveFactor = 1 + totalVATRate;

  // Base price before VAT
  const basePrice = vatInclusivePrice / vatInclusiveFactor;

  // Calculate individual tax components
  const vat = basePrice * vatRate;
  const nhil = basePrice * nhilRate;
  const getfund = basePrice * getfundRate;
  const totalVATComponents = vat + nhil + getfund;

  return {
    basePrice: Math.round(basePrice * 100) / 100,
    vat: Math.round(vat * 100) / 100,
    nhil: Math.round(nhil * 100) / 100,
    getfund: Math.round(getfund * 100) / 100,
    totalVATComponents: Math.round(totalVATComponents * 100) / 100,
    vatInclusivePrice: vatInclusivePrice,
  };
};

/**
 * Calculate COVID levy on base price
 * @param {Number} basePrice - Price before VAT
 * @param {Object} settings - Optional platform settings (if not provided, will fetch)
 * @returns {Promise<Number>|Number} COVID levy amount
 */
exports.calculateCovidLevy = async (basePrice, settings = null) => {
  if (!basePrice || basePrice <= 0) return 0;
  
  // Get settings if not provided
  if (!settings) {
    settings = await getSettings();
  }
  
  const covidLevyRate = settings.covidLevyRate || 0.01;
  return Math.round(basePrice * covidLevyRate * 100) / 100;
};

/**
 * Calculate total price with COVID levy
 * @param {Number} vatInclusivePrice - Price that includes VAT
 * @param {Object} settings - Optional platform settings (if not provided, will fetch)
 * @returns {Promise<Object>|Object} Complete price breakdown
 */
exports.calculateCompletePrice = async (vatInclusivePrice, settings = null) => {
  // Get settings if not provided
  if (!settings) {
    settings = await getSettings();
  }
  
  const taxBreakdown = await exports.extractTaxFromPrice(vatInclusivePrice, settings);
  const covidLevy = await exports.calculateCovidLevy(taxBreakdown.basePrice, settings);
  const grandTotal = vatInclusivePrice + covidLevy;

  return {
    ...taxBreakdown,
    covidLevy: Math.round(covidLevy * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
    totalTax: Math.round((taxBreakdown.totalVATComponents + covidLevy) * 100) / 100,
  };
};

/**
 * Calculate tax breakdown for multiple items
 * @param {Array} items - Array of items with vatInclusivePrice
 * @param {Object} settings - Optional platform settings (if not provided, will fetch)
 * @returns {Promise<Object>|Object} Aggregated tax breakdown
 */
exports.calculateOrderTaxBreakdown = async (items, settings = null) => {
  let totalBasePrice = 0;
  let totalVAT = 0;
  let totalNHIL = 0;
  let totalGETFund = 0;
  let totalCovidLevy = 0;
  let totalVATInclusive = 0;

  // Get settings if not provided
  if (!settings) {
    settings = await getSettings();
  }
  
  const itemBreakdowns = await Promise.all(items.map(async (item) => {
    const price = item.price || item.vatInclusivePrice || 0;
    const quantity = item.quantity || 1;
    const itemTotal = price * quantity;
    
    const breakdown = await exports.calculateCompletePrice(price, settings);
    const itemBasePrice = breakdown.basePrice * quantity;
    const itemVAT = breakdown.vat * quantity;
    const itemNHIL = breakdown.nhil * quantity;
    const itemGETFund = breakdown.getfund * quantity;
    const itemCovidLevy = breakdown.covidLevy * quantity;

    totalBasePrice += itemBasePrice;
    totalVAT += itemVAT;
    totalNHIL += itemNHIL;
    totalGETFund += itemGETFund;
    totalCovidLevy += itemCovidLevy;
    totalVATInclusive += itemTotal;

    return {
      ...item,
      basePrice: breakdown.basePrice,
      vat: breakdown.vat,
      nhil: breakdown.nhil,
      getfund: breakdown.getfund,
      covidLevy: breakdown.covidLevy,
      totalTax: breakdown.totalTax,
      itemBasePrice,
      itemVAT,
      itemNHIL,
      itemGETFund,
      itemCovidLevy,
      itemTotalTax: breakdown.totalTax * quantity,
    };
  }));

  return {
    items: itemBreakdowns,
    totals: {
      totalBasePrice: Math.round(totalBasePrice * 100) / 100,
      totalVAT: Math.round(totalVAT * 100) / 100,
      totalNHIL: Math.round(totalNHIL * 100) / 100,
      totalGETFund: Math.round(totalGETFund * 100) / 100,
      totalCovidLevy: Math.round(totalCovidLevy * 100) / 100,
      totalVATInclusive: Math.round(totalVATInclusive * 100) / 100,
      totalTax: Math.round((totalVAT + totalNHIL + totalGETFund + totalCovidLevy) * 100) / 100,
      grandTotal: Math.round((totalVATInclusive + totalCovidLevy) * 100) / 100,
    },
  };
};

/**
 * Apply discount to VAT-inclusive price and recalculate tax
 * @param {Number} vatInclusivePrice - Original VAT-inclusive price
 * @param {Number} discountAmount - Discount amount to apply
 * @param {Object} settings - Optional platform settings (if not provided, will fetch)
 * @returns {Promise<Object>|Object} Price breakdown after discount
 */
exports.applyDiscountToVATInclusivePrice = async (vatInclusivePrice, discountAmount, settings = null) => {
  if (!vatInclusivePrice || vatInclusivePrice <= 0) {
    return await exports.calculateCompletePrice(0, settings);
  }

  if (!discountAmount || discountAmount <= 0) {
    return await exports.calculateCompletePrice(vatInclusivePrice, settings);
  }

  // Apply discount to VAT-inclusive price
  const discountedPrice = Math.max(0, vatInclusivePrice - discountAmount);
  
  // Recalculate tax breakdown from discounted price
  return await exports.calculateCompletePrice(discountedPrice, settings);
};

/**
 * Get tax rates (for display purposes)
 * @param {Object} settings - Optional platform settings (if not provided, will fetch)
 * @returns {Promise<Object>|Object} Tax rates
 */
exports.getTaxRates = async (settings = null) => {
  // Get settings if not provided
  if (!settings) {
    settings = await getSettings();
  }
  
  const vatRate = settings.vatRate || 0.125;
  const nhilRate = settings.nhilRate || 0.025;
  const getfundRate = settings.getfundRate || 0.025;
  const covidLevyRate = settings.covidLevyRate || 0.01;
  
  return {
    vat: vatRate,
    nhil: nhilRate,
    getfund: getfundRate,
    totalVATComponents: vatRate + nhilRate + getfundRate,
    covidLevy: covidLevyRate,
  };
};

/**
 * Get platform settings (exported for use in controllers)
 * @returns {Promise<Object>} Platform settings
 */
exports.getPlatformSettings = getSettings;

/**
 * Calculate withholding tax
 * @param {Number} amount - Amount to calculate withholding tax on
 * @param {String} taxCategory - 'individual' or 'company'
 * @param {Object} settings - Optional platform settings (if not provided, will fetch)
 * @returns {Promise<Object>|Object} Withholding tax breakdown
 */
exports.calculateWithholdingTax = async (amount, taxCategory = 'individual', settings = null) => {
  if (!amount || amount <= 0) {
    return {
      withholdingTax: 0,
      withholdingTaxRate: 0,
      amountPaidToSeller: amount,
    };
  }
  
  // Get settings if not provided
  if (!settings) {
    settings = await getSettings();
  }
  
  const withholdingRate = taxCategory === 'company' 
    ? (settings.withholdingCompany || 0.15)
    : (settings.withholdingIndividual || 0.03);
  
  const withholdingTax = Math.round(amount * withholdingRate * 100) / 100;
  const amountPaidToSeller = Math.round((amount - withholdingTax) * 100) / 100;
  
  return {
    withholdingTax,
    withholdingTaxRate: withholdingRate,
    amountPaidToSeller,
    taxCategory,
  };
};

/**
 * Format tax breakdown for display
 * @param {Object} breakdown - Tax breakdown object
 * @returns {Object} Formatted breakdown
 */
exports.formatTaxBreakdown = (breakdown) => {
  return {
    basePrice: breakdown.basePrice?.toFixed(2) || '0.00',
    vat: breakdown.vat?.toFixed(2) || '0.00',
    nhil: breakdown.nhil?.toFixed(2) || '0.00',
    getfund: breakdown.getfund?.toFixed(2) || '0.00',
    covidLevy: breakdown.covidLevy?.toFixed(2) || '0.00',
    totalTax: breakdown.totalTax?.toFixed(2) || '0.00',
    vatInclusivePrice: breakdown.vatInclusivePrice?.toFixed(2) || '0.00',
    grandTotal: breakdown.grandTotal?.toFixed(2) || '0.00',
  };
};

