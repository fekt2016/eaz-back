const mongoose = require('mongoose');
const slugify = require('slugify');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: String,
    description: String,
    image: {
      type: String,
      default:
        'https://res.cloudinary.com/dz2xqjv8q/image/upload/v1698247967/eazworld/1_1_dk0l6h.jpg',
    },
    parentCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null, // Explicitly set null for top-level
    },
    subcategories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
      },
    ],
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    status: { type: String, default: 'active' },
    isSubcategory: {
      type: Boolean,
      default: function () {
        return !!this.parentCategory;
      },
    },
    variantStructure: {
      type: Map,
      of: new mongoose.Schema({
        variantOptions: [String],
        options: {
          type: Map,
          of: [String],
        },
      }),
      default: {},
    },
    options: {
      type: Map,
      of: [String],
      default: {},
      validate: {
        validator: function (optMap) {
          // Only validate if it's a subcategory
          if (!this.isSubcategory) return true;

          for (const [key, values] of optMap) {
            if (!Array.isArray(values)) return false;
            if (
              new Set(values.map((v) => v.toLowerCase())).size !== values.length
            ) {
              return false;
            }
          }
          return true;
        },
        message: (props) =>
          `Duplicate options are not allowed for any variant type`,
      },
    },
  },

  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        // Convert variantStructure Map to plain object for JSON
        if (ret.variantStructure instanceof Map) {
          ret.variantStructure = Object.fromEntries(ret.variantStructure);
          for (const key in ret.variantStructure) {
            if (ret.variantStructure[key].options instanceof Map) {
              ret.variantStructure[key].options = Object.fromEntries(
                ret.variantStructure[key].options,
              );
            }
          }
        }
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

// Virtual field for product count
categorySchema.virtual('productCount').get(function () {
  return this.products ? this.products.length : 0;
});

// Auto-update parent's subcategories array
categorySchema.post('save', async function (doc) {
  if (doc.parentCategory) {
    await mongoose.model('Category').findByIdAndUpdate(
      doc.parentCategory,
      { $addToSet: { subcategories: doc._id } }, // Use $addToSet to prevent duplicates
      { new: true },
    );
  }
});
// In your category schema
categorySchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    // Convert variantStructure Map to object
    if (ret.variantStructure instanceof Map) {
      ret.variantStructure = Object.fromEntries(ret.variantStructure);

      // Convert nested option Maps to objects
      for (const key in ret.variantStructure) {
        if (ret.variantStructure[key].options instanceof Map) {
          ret.variantStructure[key].options = Object.fromEntries(
            ret.variantStructure[key].options,
          );
        }
      }
    }
    return ret;
  },
});
// Add pre-save hook to convert plain objects to Maps
categorySchema.pre('save', function (next) {
  if (
    this.variantStructure &&
    typeof this.variantStructure === 'object' &&
    !(this.variantStructure instanceof Map)
  ) {
    const variantMap = new Map();

    for (const [key, value] of Object.entries(this.variantStructure)) {
      const optionsMap = new Map();

      if (value.options && typeof value.options === 'object') {
        for (const [optKey, optValue] of Object.entries(value.options)) {
          optionsMap.set(optKey, optValue);
        }
      }

      variantMap.set(key, {
        variantOptions: value.variantOptions || [],
        options: optionsMap,
      });
    }

    this.variantStructure = variantMap;
  }
  next();
});

categorySchema.pre('save', function (next) {
  this.slug = slugify(this.name, { lower: true });

  if (this.isSubcategory) {
    // Normalize variant structure
    if (this.variantStructure instanceof Map) {
      const newVariantStructure = new Map();
      for (const [key, value] of this.variantStructure) {
        const normalizedKey = key.trim();
        if (normalizedKey) {
          const normalizedValue = {
            variantOptions: (value.variantOptions || [])
              .map((opt) => opt.trim())
              .filter((opt) => opt.length > 0),
            options: new Map(),
          };

          if (value.options instanceof Map) {
            for (const [optKey, optValues] of value.options) {
              const normalizedOptKey = optKey.trim();
              if (normalizedOptKey) {
                const normalizedOptValues = optValues
                  .map((v) => v.trim())
                  .filter((v) => v.length > 0);

                if (normalizedOptValues.length > 0) {
                  normalizedValue.options.set(
                    normalizedOptKey,
                    normalizedOptValues,
                  );
                }
              }
            }
          }

          if (normalizedValue.variantOptions.length > 0) {
            newVariantStructure.set(normalizedKey, normalizedValue);
          }
        }
      }
      this.variantStructure = newVariantStructure;
    }
  }
  next();
});

categorySchema.pre('validate', function (next) {
  if (!this.isSubcategory) {
    if (this.variantStructure && this.variantStructure.size > 0) {
      this.invalidate(
        'variantStructure',
        'Variant structure can only be defined for subcategories',
      );
    }

    if (this.options && this.options.size > 0) {
      this.invalidate(
        'options',
        'Variant options can only be defined for subcategories',
      );
    }
  }
  next();
});

categorySchema.pre('find', function () {
  this.populate('parentCategory');
});
categorySchema.pre('findOne', function () {
  this.populate('parentCategory');
});

const Category = mongoose.model('Category', categorySchema);
module.exports = Category;
