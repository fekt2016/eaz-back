const taxService = require('../tax/taxService');

/**
 * Pricing Service - Unified logic for product pricing and tax application.
 * Centrally manages how prices are calculated for orders and carts.
 */

/**
 * Calculate the final price and tax breakdown for a given product/variant.
 * @param {Number} basePrice - The seller-entered base price (VAT exclusive)
 * @param {Number} promoDiscount - Optional discount applied to the INCLUSIVE price (standard for Saiisai promos)
 * @returns {Promise<Object>} Full pricing breakdown
 */
exports.calculateItemPricing = async (basePrice, promoDiscount = 0) => {
    const settings = await taxService.getPlatformSettings();

    // 1. Calculate standard VAT components on the raw base price
    const taxData = await taxService.addVatToBase(basePrice, settings);

    // 2. Apply promo discount to the VAT-inclusive price (Saiisai business rule)
    // We need to re-derive the "net" tax components after discount
    const discountedPriceInclVat = Math.max(0, taxData.priceInclVat - promoDiscount);

    // 3. Re-extract tax components from the discounted inclusive price
    // This ensures VAT/NHIL/GETFund are proportionally adjusted
    const netBreakdown = await taxService.extractTaxFromPrice(discountedPriceInclVat, settings);

    // 4. Calculate COVID Levy on the net base price
    const covidLevy = await taxService.calculateCovidLevy(netBreakdown.basePrice, settings);

    const unitPrice = discountedPriceInclVat + covidLevy;

    return {
        originalBasePrice: taxData.basePrice,
        promoDiscount,
        priceInclVat: Math.round(discountedPriceInclVat * 100) / 100,
        netBasePrice: netBreakdown.basePrice,
        vat: netBreakdown.vat,
        nhil: netBreakdown.nhil,
        getfund: netBreakdown.getfund,
        covidLevy: Math.round(covidLevy * 100) / 100,
        totalTax: Math.round((netBreakdown.totalVATComponents + covidLevy) * 100) / 100,
        unitPrice: Math.round(unitPrice * 100) / 100
    };
};

/**
 * Apply pricing logic to an order item.
 * Useful for normalizing items before saving to database.
 */
exports.applyPricingToOrderItem = async (item) => {
    // If priceExVat exists (seller side), use it as basePrice. 
    // Otherwise try to derive from price if that's all we have.
    const basePrice = item.priceExVat || item.basePrice || (item.price / 1.15);
    const discount = item.discount || 0;

    const breakdown = await exports.calculateItemPricing(basePrice, discount);

    return {
        product: item.product,
        variant: item.variant,
        quantity: item.quantity,
        sku: item.sku,
        price: breakdown.unitPrice,
        priceInclVat: breakdown.priceInclVat,
        priceExVat: breakdown.netBasePrice,
        basePrice: breakdown.netBasePrice,
        vat: breakdown.vat,
        nhil: breakdown.nhil,
        getfund: breakdown.getfund,
        covidLevy: breakdown.covidLevy,
        totalTaxes: breakdown.totalTax,
        vatAmount: breakdown.vat,
        vatRate: 0.15,
        isVATInclusive: true,
        vatCollectedBy: item.vatCollectedBy || 'platform'
    };
};
