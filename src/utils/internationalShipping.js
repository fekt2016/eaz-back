const DEFAULT_MATRIX = [
  // China bands (example values, GHS-equivalent)
  { country: 'CHINA', minWeightKg: 0, maxWeightKg: 1, shippingCost: 15, baseCustomsRate: 0.3 },
  { country: 'CHINA', minWeightKg: 1, maxWeightKg: 3, shippingCost: 25, baseCustomsRate: 0.3 },
  { country: 'CHINA', minWeightKg: 3, maxWeightKg: 5, shippingCost: 40, baseCustomsRate: 0.3 },
  { country: 'CHINA', minWeightKg: 5, maxWeightKg: 9999, shippingCost: 60, baseCustomsRate: 0.3 },

  // USA bands
  { country: 'USA', minWeightKg: 0, maxWeightKg: 1, shippingCost: 20, baseCustomsRate: 0.25 },
  { country: 'USA', minWeightKg: 1, maxWeightKg: 3, shippingCost: 35, baseCustomsRate: 0.25 },
  { country: 'USA', minWeightKg: 3, maxWeightKg: 5, shippingCost: 55, baseCustomsRate: 0.25 },
  { country: 'USA', minWeightKg: 5, maxWeightKg: 9999, shippingCost: 80, baseCustomsRate: 0.25 },
];

// Optional future extension: allow overriding via environment or DB.
const INTERNATIONAL_SHIPPING_MATRIX = DEFAULT_MATRIX;

const CATEGORY_CUSTOMS_RATES = {
  electronics: 0.2,
  phones: 0.2,
  laptops: 0.2,
  fashion: 0.15,
  clothing: 0.15,
  shoes: 0.15,
  beauty: 0.15,
  accessories: 0.18,
};

function normaliseCountry(country) {
  if (!country) return null;
  return String(country).trim().toUpperCase();
}

/**
 * Look up international shipping cost for a given country + weight band.
 *
 * @param {string} country - Supplier country (e.g. 'China', 'USA')
 * @param {number} weightKg - Shipment weight in kilograms
 * @returns {{ shippingCost: number, baseCustomsRate: number, matchedBand: { minWeightKg: number, maxWeightKg: number } | null }}
 */
function getInternationalShippingCost(country, weightKg) {
  const normalizedCountry = normaliseCountry(country);
  const w = Number(weightKg) || 0;

  if (!normalizedCountry) {
    return { shippingCost: 0, baseCustomsRate: 0, matchedBand: null };
  }

  const bands = INTERNATIONAL_SHIPPING_MATRIX.filter(
    (row) => row.country === normalizedCountry,
  );

  if (!bands.length) {
    return { shippingCost: 0, baseCustomsRate: 0, matchedBand: null };
  }

  const nonNegativeWeight = w < 0 ? 0 : w;

  // Find the first band where weight is within [min, max]; fall back to the highest band.
  let band =
    bands.find(
      (row) =>
        nonNegativeWeight >= row.minWeightKg &&
        nonNegativeWeight <= row.maxWeightKg,
    ) || bands[bands.length - 1];

  return {
    shippingCost: band.shippingCost,
    baseCustomsRate: band.baseCustomsRate,
    matchedBand: {
      minWeightKg: band.minWeightKg,
      maxWeightKg: band.maxWeightKg,
    },
  };
}

/**
 * Optional helper to override/import base customs rate by product category.
 *
 * @param {string} category - e.g. 'electronics', 'fashion'
 * @returns {number|null} - customs rate (0.25 = 25%) or null if unknown
 */
function getCustomsRateByCategory(category) {
  if (!category) return null;
  const key = String(category).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CATEGORY_CUSTOMS_RATES, key)) {
    return CATEGORY_CUSTOMS_RATES[key];
  }
  return null;
}

/**
 * Compute Ghana customs & taxes for international pre‑orders.
 *
 * Rules:
 *  - CIF = productCost + internationalShippingCost
 *  - Import Duty = CIF × importDutyRate
 *  - VAT Base = CIF + Import Duty
 *  - VAT  = 15%
 *  - NHIL = 2.5%
 *  - GETFund = 2.5%
 *  - EXIM = 0.75%
 *  - COVID levy is NOT applied for this estimate
 *  - Total customs = Import Duty + VAT + NHIL + GETFund + EXIM (+ optional clearingFee)
 *  - A 5% buffer can be applied on top of the computed total for risk protection.
 *
 * @param {Object} params
 * @param {number} params.productCost - Total product value (GHS)
 * @param {number} params.internationalShippingCost - International freight cost (GHS)
 * @param {number} params.importDutyRate - Duty rate (0.3 = 30%)
 * @param {boolean} [params.applyBuffer=true] - Whether to apply 5% safety buffer
 * @param {number} [params.clearingFee=0] - Optional clearing/handling fee (GHS)
 *
 * @returns {{
 *   cif: number,
 *   importDuty: number,
 *   vatBase: number,
 *   vat: number,
 *   nhil: number,
 *   getfund: number,
 *   exim: number,
 *   clearingFee: number,
 *   totalCustomsRaw: number,
 *   totalCustomsBuffered: number
 * }}
 */
function calculateGhanaCustoms({
  productCost,
  internationalShippingCost,
  importDutyRate,
  applyBuffer = true,
  clearingFee = 0,
}) {
  const cost = Math.max(0, Number(productCost) || 0);
  const intlShip = Math.max(0, Number(internationalShippingCost) || 0);
  const dutyRate = Math.max(0, Number(importDutyRate) || 0);
  const clearing = Math.max(0, Number(clearingFee) || 0);

  const cif = cost + intlShip;

  const importDuty = cif * dutyRate;
  const vatBase = cif + importDuty;

  const VAT_RATE = 0.15;
  const NHIL_RATE = 0.025;
  const GETFUND_RATE = 0.025;
  const EXIM_RATE = 0.0075;

  const vat = vatBase * VAT_RATE;
  const nhil = vatBase * NHIL_RATE;
  const getfund = vatBase * GETFUND_RATE;
  const exim = vatBase * EXIM_RATE;

  const rawTotal = importDuty + vat + nhil + getfund + exim + clearing;
  const bufferedTotal = applyBuffer ? rawTotal * 1.05 : rawTotal;

  const round2 = (n) => Math.round(n * 100) / 100;

  return {
    cif: round2(cif),
    importDuty: round2(importDuty),
    vatBase: round2(vatBase),
    vat: round2(vat),
    nhil: round2(nhil),
    getfund: round2(getfund),
    exim: round2(exim),
    clearingFee: round2(clearing),
    totalCustomsRaw: round2(rawTotal),
    totalCustomsBuffered: round2(bufferedTotal),
  };
}

module.exports = {
  getInternationalShippingCost,
  getCustomsRateByCategory,
  calculateGhanaCustoms,
};

