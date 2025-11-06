const mongoose = require('mongoose');
const slugify = require('slugify');
// const Category = require('./categoryModel');
// const AppError = require('../../utils/errors/appError');

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
    shortDescription: {
      type: String,
      trim: true,
      maxlength: 160,
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
    categoryPath: {
      type: String,
    },
    variants: [
      {
        attributes: [
          {
            key: {
              type: String,
              required: true,
              trim: true,
            },
            value: {
              type: String,
              required: true,
              trim: true,
            },
            _id: false,
          },
        ],
        price: {
          type: Number,
          required: [true, 'Price is required'],
          min: [0, 'Price must be at least 0'],
        },
        originalPrice: {
          type: Number,
          min: [0, 'Original price must be at least 0'],
        },
        stock: {
          type: Number,
          required: true,
          min: [0, 'Stock must be at least 0'],
        },
        sku: {
          type: String,
          required: true,
          trim: true,
          uppercase: true,
        },
        status: {
          type: String,
          enum: ['active', 'inactive'],
          default: 'active',
        },
        images: [
          {
            type: String,
            trim: true,
          },
        ],
        barcode: {
          type: String,
          trim: true,
        },
        weight: {
          value: Number,
          unit: {
            type: String,
            enum: ['g', 'kg', 'lb', 'oz'],
            default: 'g',
          },
        },
        dimensions: {
          length: Number,
          width: Number,
          height: Number,
          unit: {
            type: String,
            enum: ['cm', 'in'],
            default: 'cm',
          },
        },
        lowStockThreshold: {
          type: Number,
          default: 5,
          min: 0,
        },
      },
    ],
    price: {
      type: Number,
      // required: [true, 'Price is required'],
      min: [0, 'Price must be at least 0'],
    },
    minPrice: {
      type: Number,
      min: 0,
    },
    maxPrice: {
      type: Number,
      min: 0,
    },
    brand: {
      type: String,
      trim: true,
    },
    manufacturer: {
      name: {
        type: String,
        trim: true,
      },
      sku: {
        type: String,
        trim: true,
      },
      partNumber: {
        type: String,
        trim: true,
      },
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'draft', 'out_of_stock'],
      default: 'active',
    },
    specifications: {
      material: [
        {
          value: String,
          hexCode: String,
          _id: false,
        },
      ],
      weight: {
        value: Number,
        unit: {
          type: String,
          enum: ['g', 'kg', 'lb', 'oz'],
          default: 'g',
        },
      },
      dimensions: {
        length: Number,
        width: Number,
        height: Number,
        unit: {
          type: String,
          enum: ['cm', 'in'],
          default: 'cm',
        },
      },
      color: [
        {
          name: String,
          hexCode: String,
          _id: false,
        },
      ],
      size: String,
      other: [
        {
          key: String,
          value: String,
          _id: false,
        },
      ],
    },
    warranty: {
      duration: Number,
      type: String,
      details: String,
    },
    condition: {
      type: String,
      enum: ['new', 'used', 'refurbished', 'open_box', 'damaged', 'for_parts'],
      default: 'new',
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    keywords: [
      {
        type: String,
        trim: true,
      },
    ],
    metaTitle: String,
    metaDescription: String,
    socialMedia: {
      facebook: Boolean,
      instagram: Boolean,
      twitter: Boolean,
    },
    totalSold: {
      type: Number,
      default: 0,
    },
    totalViews: {
      type: Number,
      default: 0,
    },
    popularity: {
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
    shipping: {
      weight: {
        value: Number,
        unit: {
          type: String,
          enum: ['g', 'kg', 'lb', 'oz'],
          default: 'g',
        },
      },
      dimensions: {
        length: Number,
        width: Number,
        height: Number,
        unit: {
          type: String,
          enum: ['cm', 'in'],
          default: 'cm',
        },
      },
      freeShipping: {
        type: Boolean,
        default: false,
      },
      shippingClass: {
        type: String,
        enum: ['standard', 'express', 'oversized', 'fragile'],
        default: 'standard',
      },
    },
    tax: {
      taxable: {
        type: Boolean,
        default: true,
      },
      taxClass: {
        type: String,
        enum: ['standard', 'reduced', 'zero'],
        default: 'standard',
      },
    },
    availability: {
      startDate: {
        type: Date,
        default: Date.now,
      },
      endDate: Date,
      status: {
        type: String,
        enum: ['available', 'coming_soon', 'discontinued'],
        default: 'available',
      },
    },
    relatedProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    crossSellProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    upSellProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    isDigital: {
      type: Boolean,
      default: false,
    },
    digitalFile: {
      url: String,
      name: String,
      size: Number,
      downloadLimit: Number,
      expiryDays: Number,
    },
    isSubscription: {
      type: Boolean,
      default: false,
    },
    subscription: {
      interval: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
      },
      intervalCount: Number,
      trialPeriodDays: Number,
    },
    customFields: [
      {
        key: String,
        value: mongoose.Schema.Types.Mixed,
        _id: false,
      },
    ],
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    timestamps: true,
  },
);

// Pre-save middleware
productSchema.pre('save', function (next) {
  // Generate slug
  this.slug = slugify(this.name, {
    lower: true,
    strict: true,
    trim: true,
  });

  // Set the top-level price to the first variant's price if not set
  if (this.variants && this.variants.length > 0 && this.variants[0].price) {
    this.price = this.variants[0].price;
  }

  // Calculate min and max prices from variants
  if (this.variants && this.variants.length > 0) {
    const prices = this.variants.map((v) => v.price);
    this.minPrice = Math.min(...prices);
    this.maxPrice = Math.max(...prices);

    // Update status based on stock
    const totalStock = this.variants.reduce(
      (sum, variant) => sum + variant.stock,
      0,
    );
    if (totalStock === 0 && this.status !== 'draft') {
      this.status = 'out_of_stock';
    } else if (totalStock > 0 && this.status === 'out_of_stock') {
      this.status = 'active';
    }
  }

  // Generate category path for better filtering
  if (this.parentCategory && this.subCategory) {
    this.categoryPath = `${this.parentCategory}/${this.subCategory}`;
  }
  if (this.variants && this.variants.length > 0 && this.variants[0].price) {
    this.price = this.variants[0].price;
  }
  // Calculate popularity score based on views, sales, and ratings
  this.popularity =
    this.totalViews * 0.1 + this.totalSold * 0.5 + this.ratingsAverage * 10;

  next();
});

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

productSchema.virtual('hasStock').get(function () {
  return this.totalStock > 0;
});

productSchema.virtual('isOnSale').get(function () {
  return (this.variants || []).some(
    (variant) => variant.originalPrice && variant.price < variant.originalPrice,
  );
});

productSchema.virtual('salePercentage').get(function () {
  if (!this.isOnSale) return 0;

  const variant = this.variants.find(
    (v) => v.originalPrice && v.price < v.originalPrice,
  );

  if (!variant) return 0;

  return Math.round(
    ((variant.originalPrice - variant.price) / variant.originalPrice) * 100,
  );
});

// Method to apply discounts to a product
productSchema.methods.applyDiscounts = async function () {
  console.log('applyDiscounts called');
  const Discount = mongoose.model('Discount');
  const now = new Date();

  // Find all applicable discounts for this product
  const discounts = await Discount.find({
    $or: [
      { products: this._id },
      { categories: { $in: [this.parentCategory, this.subCategory] } },
      { products: { $size: 0 }, categories: { $size: 0 }, seller: this.seller }, // Store-wide discounts from this seller
    ],
    active: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  });
  console.log(discounts);
  // Track if any discount was applied
  let discountApplied = false;
  // console.log('variants', this.variants);
  // Apply the best discount to each variant
  for (let i = 0; i < this.variants.length; i++) {
    let bestDiscountedPrice = this.variants[i].price;
    // console.log('bestDiscountedPrice', bestDiscountedPrice);
    let bestDiscount = null;

    // Store original price if not already set
    if (!this.variants[i].originalPrice) {
      this.variants[i].originalPrice = this.variants[i].price;
    }

    // Check each discount to find the best one for this variant
    for (const discount of discounts) {
      let discountedPrice = this.variants[i].originalPrice;

      switch (discount.type) {
        case 'percentage':
          discountedPrice =
            this.variants[i].originalPrice * (1 - discount.value / 100);
          break;
        case 'fixed':
          discountedPrice = Math.max(
            0,
            this.variants[i].originalPrice - discount.value,
          );
          break;
      }
      // console.log('discountedPrice', discountedPrice);
      // Track the best discount (lowest price)
      if (discountedPrice < bestDiscountedPrice) {
        bestDiscountedPrice = discountedPrice;
        // console.log('bestDiscountedPrice', bestDiscountedPrice);
        bestDiscount = discount;
        // console.log('bestDiscount', bestDiscount);
      }
    }

    // Apply the best discount if found
    if (bestDiscount) {
      this.variants[i].price = Math.round(bestDiscountedPrice * 100) / 100;
      // Round to 2 decimal places
      // console.log('variant price', this.variants[i].price);
      discountApplied = true;
    } else {
      // Reset to original price if no discount applies
      this.variants[i].price = this.variants[i].originalPrice;
    }
  }

  // Update min and max prices
  const prices = this.variants.map((v) => v.price);
  this.minPrice = Math.min(...prices);
  this.maxPrice = Math.max(...prices);
  console.log('discountApplied', discountApplied);
  return discountApplied;
};

// Method to remove all discounts and revert to original prices
productSchema.methods.removeDiscounts = function () {
  let changesMade = false;

  for (let i = 0; i < this.variants.length; i++) {
    if (this.variants[i].originalPrice) {
      this.variants[i].price = this.variants[i].originalPrice;
      changesMade = true;
    }
  }

  if (changesMade) {
    const prices = this.variants.map((v) => v.price);
    this.minPrice = Math.min(...prices);
    this.maxPrice = Math.max(...prices);
  }

  return changesMade;
};

// Middleware
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

// Add a pre-save middleware to automatically generate tags
productSchema.pre('save', async function (next) {
  // Only generate tags if the product is new or name/description changed
  if (this.isNew || this.isModified('name') || this.isModified('description')) {
    await this.generateTags();
  }
  next();
});

// Add a method to generate tags
productSchema.methods.generateTags = function () {
  const tags = new Set();

  this.name
    ?.toLowerCase()
    .split(/\s+/)
    .forEach((w) => {
      if (w.length > 2) tags.add(w);
    });

  this.description
    ?.toLowerCase()
    .split(/\s+/)
    .forEach((w) => {
      if (w.length > 3) tags.add(w);
    });

  if (this.brand) tags.add(this.brand.toLowerCase());
  if (this.manufacturer?.name) tags.add(this.manufacturer.name.toLowerCase());

  if (this.specifications?.material) {
    this.specifications.material.forEach((m) => {
      if (m.value)
        m.value.split(',').forEach((val) => tags.add(val.trim().toLowerCase()));
    });
  }

  if (this.specifications?.color) {
    this.specifications.color.forEach((c) => {
      if (c.name) tags.add(c.name.toLowerCase());
    });
  }

  if (this.variants) {
    this.variants.forEach((v) => {
      v.attributes?.forEach((attr) => {
        tags.add(`${attr.key}:${attr.value}`.toLowerCase());
      });
    });
  }

  this.tags = Array.from(tags).filter(Boolean).slice(0, 20); // no save here!
};

// Indexes for better search performance
productSchema.index(
  {
    name: 'text',
    description: 'text',
    brand: 'text',
    tags: 'text',
    'specifications.color.name': 'text',
    'manufacturer.name': 'text',
    'variants.attributes.value': 'text',
  },
  {
    name: 'search_index',
    weights: {
      name: 10,
      tags: 8,
      brand: 6,
      'manufacturer.name': 5,
      description: 4,
      'specifications.color.name': 3,
      'variants.attributes.value': 2,
    },
  },
);

// Compound indexes for common query patterns
productSchema.index({ seller: 1, status: 1 });
productSchema.index({ parentCategory: 1, status: 1 });
productSchema.index({ subCategory: 1, status: 1 });
productSchema.index({ categoryPath: 1, status: 1 });
productSchema.index({ price: 1, status: 1 });
productSchema.index({ minPrice: 1, maxPrice: 1, status: 1 });
productSchema.index({ ratingsAverage: -1, popularity: -1 });
productSchema.index({ totalSold: -1, createdAt: -1 });
productSchema.index({ brand: 1, parentCategory: 1 });
productSchema.index({ tags: 1, status: 1 });
productSchema.index({ 'variants.sku': 1 });
productSchema.index({
  'variants.attributes.key': 1,
  'variants.attributes.value': 1,
});
productSchema.index({ createdAt: -1 });
productSchema.index({ updatedAt: -1 });

// Static methods
productSchema.statics.calcAverageRatings = async function (productId) {
  // Implementation for calculating average ratings
};

// Method to update stock
productSchema.methods.updateStock = function (variantIndex, quantity) {
  if (this.variants[variantIndex]) {
    this.variants[variantIndex].stock += quantity;

    // Update total stock and status
    const totalStock = this.variants.reduce(
      (sum, variant) => sum + variant.stock,
      0,
    );
    if (totalStock === 0) {
      this.status = 'out_of_stock';
    } else if (this.status === 'out_of_stock') {
      this.status = 'active';
    }

    return this.save();
  }
  throw new Error('Variant not found');
};

// Method to check if a variant combination exists
productSchema.methods.findVariant = function (attributes) {
  return this.variants.find((variant) => {
    return variant.attributes.every((attr) => {
      const match = attributes.find((a) => a.key === attr.key);
      return match && match.value === attr.value;
    });
  });
};

// Method to get all available attribute combinations
productSchema.methods.getAvailableAttributes = function () {
  const attributes = {};

  this.variants.forEach((variant) => {
    variant.attributes.forEach((attr) => {
      if (!attributes[attr.key]) {
        attributes[attr.key] = new Set();
      }
      attributes[attr.key].add(attr.value);
    });
  });

  // Convert sets to arrays
  const result = {};
  Object.keys(attributes).forEach((key) => {
    result[key] = Array.from(attributes[key]);
  });

  return result;
};

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
