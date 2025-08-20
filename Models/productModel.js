const mongoose = require('mongoose');
const slugify = require('slugify');
const Category = require('./categoryModel'); // Assuming categoryModel.js is in the same directory
const AppError = require('../utils/appError');
const productSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    slug: String,
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
    },
    ratingDistribution: {
      5: { type: Number, default: 0 },
      4: { type: Number, default: 0 },
      3: { type: Number, default: 0 },
      2: { type: Number, default: 0 },
      1: { type: Number, default: 0 },
    },
    imageCover: {
      type: String,
      required: [true, 'Cover image is required'],
      trim: true,
    },
    images: [
      {
        type: String,
        trim: true,
      },
    ],
    parentCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Parent category is required'],
    },
    subCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Sub category is required'],
    },
    variants: [
      {
        attributes: [
          {
            key: {
              type: String,
              required: true,
            },
            value: {
              type: String,
              required: true,
            },
          },
        ],
        price: {
          type: Number,
          required: true,
          min: [0, 'Price must be at least 0'],
        },
        stock: {
          type: Number,
          required: true,
          min: [0, 'Stock must be at least 0'],
        },
        sku: {
          type: String,
          required: true,
        },
        status: {
          type: String,
          enum: ['active', 'inactive'],
          default: 'active',
        },
      },
    ],
    brand: {
      type: String,
      trim: true,
    },
    specifications: {
      material: {
        type: [{ value: [String], hexCode: String }],
        default: [],
      },
      weight: {
        type: String,
        default: '',
      },
      dimension: {
        type: String,
        default: '',
      },
    },
    manufacturer: {
      type: String,
      trim: true,
    },
    warranty: {
      duration: Number, // Warranty period in months
      type: String, // "Manufacturer", "Seller", etc.
    },
    condition: {
      type: String,
      enum: [
        'new',
        'used',
        'refurbished',
        'openBox',
        'damaged',
        'other',
        'for parts',
      ],
      default: 'new',
    },
    totalSold: {
      type: Number,
      default: 0,
    },
    totalViews: {
      type: Number,
      default: 0,
    },
    ratingsQuantity: {
      type: Number,
      default: 0,
    },
    ratingsAverage: {
      type: Number,
      default: 4.5,
      min: [1, 'Rating must be above 1.0'],
      max: [5, 'Rating must be below 5.0'],
      set: (val) => Math.round(val * 10) / 10,
    },
    discounts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Discount',
      },
    ],
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    timestamps: true,
  },
);

// Virtual populate
productSchema.virtual('reviews', {
  ref: 'Review',
  foreignField: 'product',
  localField: '_id',
});

// Virtuals
productSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

productSchema.virtual('totalStock').get(function () {
  return Array.isArray(this.variants)
    ? this.variants.reduce((sum, variant) => sum + variant.stock, 0)
    : 0;
});

productSchema.virtual('minPrice').get(function () {
  if (!Array.isArray(this.variants) || this.variants.length === 0) return 0;
  return Math.min(...this.variants.map((v) => v.price));
});

productSchema.virtual('maxPrice').get(function () {
  if (!Array.isArray(this.variants) || this.variants.length === 0) return 0;
  return Math.max(...this.variants.map((v) => v.price));
});

productSchema.virtual('defaultPrice').get(function () {
  if (!Array.isArray(this.variants) || this.variants.length === 0) return 0;
  return this.variants[0].price;
});

productSchema.virtual('defaultStock').get(function () {
  if (!Array.isArray(this.variants) || this.variants.length === 0) return 0;
  return this.variants[0].stock;
});

productSchema.virtual('defaultSku').get(function () {
  if (!Array.isArray(this.variants) || this.variants.length === 0) return '';
  return this.variants[0].sku;
});

productSchema.virtual('defaultAttributes').get(function () {
  if (!Array.isArray(this.variants) || this.variants.length === 0) return [];
  return this.variants[0].attributes;
});

productSchema.virtual('defaultStatus').get(function () {
  if (!Array.isArray(this.variants) || this.variants.length === 0)
    return 'inactive';
  return this.variants[0].status;
});

productSchema.virtual('status').get(function () {
  if (!Array.isArray(this.variants) || this.variants.length === 0)
    return 'inactive';
  if (this.totalStock === 0) return 'outOfStock';
  if (this.variants.some((v) => v.status === 'active')) return 'active';
  return 'inactive';
});

// Middleware
productSchema.pre('save', function (next) {
  this.slug = slugify(this.name, {
    lower: true,
    strict: true,
    trim: true,
  });
  next();
});

productSchema.pre('validate', function (next) {
  if (this.variants.length === 0) {
    this.invalidate('variants', 'Product must have at least one variant');
  }

  // Validate that each variant has at least one attribute
  this.variants.forEach((variant, index) => {
    if (!variant.attributes || variant.attributes.length === 0) {
      this.invalidate(
        `variants.${index}`,
        'Variant must have at least one attribute',
      );
    }
  });

  next();
});
productSchema.post('save', async function (doc) {
  await Seller.updateProductCount(doc.seller);
});

// Update seller's product count on product deletion
productSchema.post('remove', async function (doc) {
  await Seller.updateProductCount(doc.seller);
});

// Update seller's product count when seller changes
productSchema.post('findOneAndUpdate', async function (doc) {
  if (doc && this._update.seller) {
    // Update both old and new sellers if seller changed
    await Seller.updateProductCount(doc.seller); // Old seller
    await Seller.updateProductCount(this._update.seller); // New seller
  }
});

// Indexes (updated for new structure)
productSchema.index(
  {
    name: 'text',
    description: 'text',
    brand: 'text',
    'specifications.material.value': 'text',
    'variants.attributes.value': 'text',
  },
  {
    weights: {
      name: 5,
      description: 3,
      brand: 2,
      'specifications.material.value': 1,
      'variants.attributes.value': 1,
    },
  },
);

productSchema.index({ slug: 1 });
productSchema.index({ seller: 1 });
productSchema.index({ parentCategory: 1 });
productSchema.index({ subCategory: 1 });

// Static methods remain the same
productSchema.statics.calcAverageRatings = async function (productId) {
  // ... same as before
};

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
