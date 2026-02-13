const {
  getInternationalShippingCost,
} = require('../../utils/internationalShipping');
const InternationalShippingConfig = require('../../models/shipping/internationalShippingConfigModel');

/**
 * Return a view of the international shipping matrix for admin UI.
 *
 * Primary source:
 *  - DB-backed InternationalShippingConfig (China/USA → Ghana)
 *
 * Fallback (for backward compatibility):
 *  - Hardcoded matrix from utils/internationalShipping when no configs exist
 */
exports.getInternationalShippingMatrix = async (req, res, next) => {
  try {
    const configs = await InternationalShippingConfig.find({}).lean();
    let bands = [];

    if (configs && configs.length) {
      // Build matrix directly from admin-managed configs
      configs.forEach((cfg) => {
        const upperCountry = String(cfg.country || '').toUpperCase();
        if (!upperCountry) return;

        (cfg.weightRanges || []).forEach((r) => {
          if (r == null) return;
          bands.push({
            country: upperCountry,
            minWeightKg: r.minWeight,
            maxWeightKg: r.maxWeight,
            shippingCost: r.shippingCost,
            baseCustomsRate: cfg.defaultImportDutyRate ?? 0,
          });
        });
      });
    } else {
      // Fallback: derive bands from legacy hardcoded matrix so old setups keep working
      const weights = [0.5, 1, 2, 4, 6];
      const countries = ['China', 'USA'];
      const tmp = [];

      for (const country of countries) {
        for (const weight of weights) {
          const result = getInternationalShippingCost(country, weight);
          if (result.matchedBand) {
            const key = `${country.toUpperCase()}-${result.matchedBand.minWeightKg}-${result.matchedBand.maxWeightKg}`;
            if (!tmp.find((b) => b.key === key)) {
              tmp.push({
                key,
                country: country.toUpperCase(),
                minWeightKg: result.matchedBand.minWeightKg,
                maxWeightKg: result.matchedBand.maxWeightKg,
                shippingCost: result.shippingCost,
                baseCustomsRate: result.baseCustomsRate,
              });
            }
          }
        }
      }

      bands = tmp.map(({ key, ...rest }) => rest);
    }

    res.status(200).json({
      status: 'success',
      data: {
        bands,
      },
    });
  } catch (err) {
    next(err);
  }
};

