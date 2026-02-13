const mongoose = require('mongoose');

/**
 * ImportDutyByCategory Model
 * Category-specific import duty rates for international shipping.
 * Used when product category matches; otherwise defaultImportDutyRate from InternationalShippingConfig.
 * Admin-only management.
 */
const importDutyByCategorySchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    dutyRate: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

importDutyByCategorySchema.statics.getByCategory = async function (category) {
  if (!category) return null;
  const key = String(category).trim().toLowerCase();
  const doc = await this.findOne({ category: key }).lean();
  return doc ? doc.dutyRate : null;
};

importDutyByCategorySchema.statics.getAllRates = async function () {
  return this.find({}).sort({ category: 1 }).lean();
};

module.exports = mongoose.model(
  'ImportDutyByCategory',
  importDutyByCategorySchema
);
