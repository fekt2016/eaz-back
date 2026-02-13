/**
 * International Shipping Calculation Service
 * DB-backed calculation for China/USA → Ghana international shipping.
 * Falls back to hardcoded values when no DB config exists.
 * Does NOT affect local/normal shipping logic.
 */

const InternationalShippingConfig = require('../../models/shipping/internationalShippingConfigModel');
const ImportDutyByCategory = require('../../models/shipping/importDutyByCategoryModel');
const {
  getInternationalShippingCost,
  getCustomsRateByCategory,
  calculateGhanaCustoms,
} = require('../../utils/internationalShipping');

// Ghana tax rates (fixed per spec)
const VAT_RATE = 0.15;
const NHIL_RATE = 0.025;
const GETFUND_RATE = 0.025;
const EXIM_RATE = 0.0075;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function normaliseCountry(country) {
  if (!country) return null;
  const s = String(country).trim();
  if (!s) return null;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Get weight-based shipping cost from config or fallback
 * @param {string} country - "China" | "USA"
 * @param {number} weightKg - Weight in kg
 * @returns {{ shippingCost: number, fromDb: boolean }}
 */
async function getWeightBasedShippingCost(country, weightKg) {
  const normalized = normaliseCountry(country);
  if (!normalized || (normalized !== 'China' && normalized !== 'USA')) {
    return { shippingCost: 0, fromDb: false };
  }

  const config = await InternationalShippingConfig.getByCountry(normalized);
  if (config && config.weightRanges && config.weightRanges.length > 0) {
    const w = Math.max(0, Number(weightKg) || 0);
    const sorted = [...config.weightRanges].sort((a, b) => a.minWeight - b.minWeight);
    const band = sorted.find(
      (r) => w >= r.minWeight && w <= r.maxWeight
    ) || sorted[sorted.length - 1];
    if (band) {
      return { shippingCost: band.shippingCost, fromDb: true };
    }
  }

  const fallback = getInternationalShippingCost(normalized, weightKg);
  return { shippingCost: fallback.shippingCost || 0, fromDb: false };
}

/**
 * Get duty rate: category-specific from DB, else category from hardcoded, else default from config
 * @param {string} category - Product category
 * @param {Object} config - InternationalShippingConfig (from DB) or null
 * @returns {number} Duty rate (0–1)
 */
async function getDutyRate(category, config) {
  if (category) {
    const fromDb = await ImportDutyByCategory.getByCategory(category);
    if (fromDb != null) return Number(fromDb);
    const fromHardcoded = getCustomsRateByCategory(category);
    if (fromHardcoded != null) return Number(fromHardcoded);
  }
  if (config && config.defaultImportDutyRate != null) {
    return Number(config.defaultImportDutyRate);
  }
  const normalized = config?.country ? config.country : null;
  const fallback = getInternationalShippingCost(normalized || 'China', 1);
  return fallback.baseCustomsRate || 0.3;
}

/**
 * Calculate full international shipping breakdown.
 * Uses DB config when available; falls back to hardcoded matrix.
 *
 * @param {Object} params
 * @param {string} params.country - "China" | "USA"
 * @param {number} params.weight - Weight in kg
 * @param {number} params.productPrice - Product/subtotal value (GHS)
 * @param {string} [params.category] - Product category for duty lookup
 *
 * @returns {Promise<{
 *   shippingCost: number,
 *   importDuty: number,
 *   vat: number,
 *   nhil: number,
 *   getFund: number,
 *   exim: number,
 *   totalCustoms: number,
 *   clearingFee: number,
 *   localDeliveryFee: number,
 *   landedCost: number,
 *   cif: number,
 *   dutyRate: number,
 *   fromDb: boolean
 * }>}
 */
async function calculateInternationalShipping({
  country,
  weight,
  productPrice,
  category,
}) {
  const normalized = normaliseCountry(country);
  if (!normalized || (normalized !== 'China' && normalized !== 'USA')) {
    return {
      shippingCost: 0,
      importDuty: 0,
      vat: 0,
      nhil: 0,
      getFund: 0,
      exim: 0,
      totalCustoms: 0,
      clearingFee: 0,
      localDeliveryFee: 0,
      landedCost: Math.max(0, Number(productPrice) || 0),
      cif: Math.max(0, Number(productPrice) || 0),
      dutyRate: 0,
      fromDb: false,
    };
  }

  const config = await InternationalShippingConfig.getByCountry(normalized);
  const { shippingCost, fromDb: shippingFromDb } = await getWeightBasedShippingCost(
    normalized,
    weight || 0.5
  );

  const dutyRate = await getDutyRate(category, config);
  const clearingFee = config ? Number(config.clearingFee) || 0 : 0;
  const localDeliveryFee = config ? Number(config.localDeliveryFee) || 0 : 0;
  const bufferPercent = config ? Number(config.customsBufferPercent) || 5 : 5;
  const bufferMultiplier = 1 + bufferPercent / 100;

  const productCost = Math.max(0, Number(productPrice) || 0);
  const cif = productCost + shippingCost;
  const importDuty = round2(cif * dutyRate);
  const vatBase = cif + importDuty;
  const vat = round2(vatBase * VAT_RATE);
  const nhil = round2(vatBase * NHIL_RATE);
  const getFund = round2(vatBase * GETFUND_RATE);
  const exim = round2(vatBase * EXIM_RATE);
  const totalCustomsRaw = importDuty + vat + nhil + getFund + exim;
  const totalCustoms = round2(totalCustomsRaw * bufferMultiplier);

  const landedCost = round2(
    productCost + shippingCost + totalCustoms + clearingFee + localDeliveryFee
  );

  return {
    shippingCost,
    importDuty,
    vat,
    nhil,
    getFund,
    exim,
    totalCustoms,
    clearingFee,
    localDeliveryFee,
    landedCost,
    cif: round2(cif),
    dutyRate,
    fromDb: !!(config && shippingFromDb),
  };
}

module.exports = {
  calculateInternationalShipping,
  getWeightBasedShippingCost,
  getDutyRate,
};
