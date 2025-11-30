const mongoose = require('mongoose');

/**
 * Platform Settings Model
 * Stores all tax rates and platform fee settings
 * Only one document should exist - use findOneAndUpdate with upsert: true
 */
const platformSettingsSchema = new mongoose.Schema({
  // VAT Components (Ghana GRA)
  vatRate: {
    type: Number,
    default: 0.125, // 12.5%
    min: 0,
    max: 1,
    comment: 'VAT rate (12.5%)',
  },
  nhilRate: {
    type: Number,
    default: 0.025, // 2.5%
    min: 0,
    max: 1,
    comment: 'NHIL rate (2.5%)',
  },
  getfundRate: {
    type: Number,
    default: 0.025, // 2.5%
    min: 0,
    max: 1,
    comment: 'GETFund rate (2.5%)',
  },
  // COVID Levy
  covidLevyRate: {
    type: Number,
    default: 0.01, // 1%
    min: 0,
    max: 1,
    comment: 'COVID levy rate (1%)',
  },
  // Withholding Tax Rates
  withholdingIndividual: {
    type: Number,
    default: 0.03, // 3%
    min: 0,
    max: 1,
    comment: 'Withholding tax rate for individual sellers (3%)',
  },
  withholdingCompany: {
    type: Number,
    default: 0.15, // 15%
    min: 0,
    max: 1,
    comment: 'Withholding tax rate for company sellers (15%)',
  },
  // Platform Fees
  platformCommissionRate: {
    type: Number,
    default: 0, // 0% (recently changed from 0.05)
    min: 0,
    max: 1,
    comment: 'Platform commission rate (0%)',
  },
}, {
  timestamps: true,
});

/**
 * Get or create platform settings (singleton pattern)
 * @returns {Promise<Object>} Platform settings document
 */
platformSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  
  if (!settings) {
    // Create default settings if none exist
    settings = await this.create({});
  }
  
  return settings;
};

/**
 * Update settings (only updates provided fields)
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated settings document
 */
platformSettingsSchema.statics.updateSettings = async function (updates) {
  const settings = await this.findOneAndUpdate(
    {},
    { $set: updates },
    { new: true, upsert: true, runValidators: true }
  );
  
  return settings;
};

const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);

module.exports = PlatformSettings;

