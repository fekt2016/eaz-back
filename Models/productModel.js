const mongoose = require('mongoose');
const slugify = require('slugify');
const Category = require('./categoryModel');
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
          required: true,
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
      required: [true, 'Price is required'],
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
  return this.variants.some(
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
// Add a pre-save middleware to automatically generate tags
productSchema.pre('save', async function (next) {
  // Only generate tags if the product is new or name/description changed
  if (this.isNew || this.isModified('name') || this.isModified('description')) {
    await this.generateTags();
  }
  next();
});

// Add a method to generate tags
productSchema.methods.generateTags = async function () {
  const tags = new Set();

  // Add words from name and description
  this.name
    .toLowerCase()
    .split(/\s+/)
    .forEach((word) => {
      if (word.length > 2) tags.add(word); // Skip very short words
    });

  this.description
    .toLowerCase()
    .split(/\s+/)
    .forEach((word) => {
      if (word.length > 3) tags.add(word); // Skip very short words
    });

  // Add brand
  if (this.brand) {
    tags.add(this.brand.toLowerCase());
  }

  // Add manufacturer name
  if (this.manufacturer && this.manufacturer.name) {
    tags.add(this.manufacturer.name.toLowerCase());
  }

  // Add material tags
  if (this.specifications && this.specifications.material) {
    this.specifications.material.forEach((material) => {
      if (material.value) {
        material.value.split(',').forEach((value) => {
          tags.add(value.trim().toLowerCase());
        });
      }
    });
  }

  // Add color tags
  if (this.specifications && this.specifications.color) {
    this.specifications.color.forEach((color) => {
      if (color.name) {
        tags.add(color.name.toLowerCase());
      }
    });
  }

  // Add variant attributes as tags
  if (this.variants) {
    this.variants.forEach((variant) => {
      if (variant.attributes) {
        variant.attributes.forEach((attr) => {
          tags.add(`${attr.key}:${attr.value}`.toLowerCase());
        });
      }
    });
  }

  // Add category names (you'll need to populate these first)
  if (this.populated('parentCategory') && this.parentCategory.name) {
    tags.add(this.parentCategory.name.toLowerCase());
  }

  if (this.populated('subCategory') && this.subCategory.name) {
    tags.add(this.subCategory.name.toLowerCase());
  }

  // Convert Set to Array and remove any empty values
  this.tags = Array.from(tags).filter((tag) => tag && tag.length > 0);

  // Limit to a reasonable number of tags (e.g., 20)
  if (this.tags.length > 20) {
    this.tags = this.tags.slice(0, 20);
  }

  return this.save();
};

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
