const mongoose = require('mongoose');
const slugify = require('slugify');
// import Category from './categoryModel.js';
// import AppError from '../../utils/errors/appError.js';

const productSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: true,
    },
    isEazShopProduct: {
      type: Boolean,
      default: false,
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
        name: {
          type: String,
          trim: true,
        },
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
        discount: {
          type: Number,
          min: [0, 'Discount must be at least 0'],
          default: 0,
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
        description: {
          type: String,
          trim: true,
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
        condition: {
          type: String,
          enum: ['new', 'used', 'open_box', 'refurbished', 'like_new', 'fair', 'poor'],
          default: 'new',
          required: [true, 'Variant condition is required'],
          comment: 'Product condition: new, used, open_box, refurbished, like_new, fair, poor',
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        updatedAt: {
          type: Date,
          default: Date.now,
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
      enum: ['active', 'inactive', 'draft', 'out_of_stock', 'archived'],
      default: 'active',
    },
    moderationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    moderationNotes: {
      type: String,
      trim: true,
    },
    moderatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    moderatedAt: {
      type: Date,
    },
    // Soft delete fields - track deletion by admin or seller separately
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
      comment: 'General soft delete flag - true if deleted by admin or seller',
    },
    isDeletedByAdmin: {
      type: Boolean,
      default: false,
      index: true,
      comment: 'Set to true when product is deleted/archived by admin',
    },
    isDeletedBySeller: {
      type: Boolean,
      default: false,
      index: true,
      comment: 'Set to true when product is deleted/archived by seller',
    },
    deletedAt: {
      type: Date,
      default: null,
      comment: 'Timestamp when product was archived/deleted',
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'deletedByRole', // Can reference Admin or Seller based on deletedByRole
      default: null,
      comment: 'ID of admin or seller who deleted the product',
    },
    deletedByRole: {
      type: String,
      enum: ['admin', 'seller', null],
      default: null,
      comment: 'Role of user who deleted the product (admin or seller)',
    },
    deletionReason: {
      type: String,
      trim: true,
      default: null,
      comment: 'Reason for product removal (admin/seller notes)',
    },
    // Visibility control: Products are only visible to buyers if seller is verified
    // This field is automatically managed based on seller.verificationStatus
    isVisible: {
      type: Boolean,
      default: false,
      index: true, // Index for performance on buyer queries
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
    shippingType: {
      type: String,
      enum: ['normal', 'heavy'],
      default: 'normal',
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
    // AI Embedding for semantic search and recommendations
    embedding: {
      type: [Number],
      default: null,
      select: false, // Don't include in default queries (large array)
    },
    embeddingUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    timestamps: true,
  },
);

// Pre-save middleware - Update variant timestamps
productSchema.pre('save', function (next) {
  // Update timestamps for variants
  if (this.variants && this.variants.length > 0) {
    const now = new Date();
    this.variants.forEach((variant) => {
      // Set createdAt if it doesn't exist (new variant)
      if (!variant.createdAt) {
        variant.createdAt = now;
      }
      // Always update updatedAt when product is saved
      variant.updatedAt = now;
    });
  }
  next();
});

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
    const prices = this.variants
      .map((v) => v.price)
      .filter((p) => p != null && !isNaN(p) && isFinite(p));
    if (prices.length > 0) {
      this.minPrice = Math.min(...prices);
      this.maxPrice = Math.max(...prices);
    }

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

  // Pre-save middleware: Update isVisible BEFORE save
  // This ensures visibility is set correctly even if post-save fails.
  // A product is considered visible (and therefore orderable) only when:
  // - the associated seller is verified
  // - the product status is active / out_of_stock
  // - the product is approved by an admin
  // - the product is not soft‑deleted
productSchema.pre('save', async function (next) {
  // Only update if seller exists
  if (this.seller) {
    try {
      const Seller = mongoose.model('Seller');
      // Handle both populated and unpopulated seller
      let seller;
      
      // Check if seller is populated (has _id or verificationStatus property)
      const isPopulated = this.seller && 
                         typeof this.seller === 'object' && 
                         (this.seller._id || this.seller.verificationStatus !== undefined);
      
      if (isPopulated) {
        // Seller is already populated
        seller = this.seller;
      } else {
        // Seller is just an ObjectId (string or ObjectId instance), fetch it
        const sellerId = this.seller.toString ? this.seller.toString() : this.seller;
        seller = await Seller.findById(sellerId).select('verificationStatus').lean();
      }
      
      if (seller) {
        // Product is visible to buyers only if the seller is verified AND
        // the product itself is active / out of stock and approved.
        const isSellerVerified = seller.verificationStatus === 'verified';
        const shouldBeVisible =
          isSellerVerified &&
          (this.status === 'active' || this.status === 'out_of_stock') &&
          this.moderationStatus === 'approved' &&
          !this.isDeleted && !this.isDeletedByAdmin && !this.isDeletedBySeller;
        
        // Set visibility directly on the document before save
        this.isVisible = shouldBeVisible;
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[Product Pre-Save] Visibility updated:', {
            productId: this._id,
            productName: this.name,
            productStatus: this.status,
            moderationStatus: this.moderationStatus,
            isVisible: shouldBeVisible,
          });
        }
      } else {
        // If we cannot resolve the seller, play it safe and hide the product
        // from buyer listings. Orders against such products will also be
        // rejected by the order controller because seller verification is
        // required there as well.
        this.isVisible = false;
        
        if (process.env.NODE_ENV === 'development') {
          console.warn('[Product Pre-Save] Seller not found, setting visibility based on product status and moderation:', {
            productStatus: this.status,
            moderationStatus: this.moderationStatus,
            isVisible: shouldBeVisible,
          });
        }
      }
    } catch (error) {
      // Log error but don't fail save - visibility will be false by default
      console.error('[Product Pre-Save] Error updating visibility:', error);
      try {
        const logger = require('../../utils/logger');
        logger.error('[Product Pre-Save] Error details:', {
          error: error.message,
          stack: error.stack,
          seller: this.seller,
          sellerType: typeof this.seller,
        });
      } catch (loggerError) {
        // If logger fails, just use console
        console.error('[Product Pre-Save] Logger error:', loggerError);
      }
      this.isVisible = false; // Safe default
    }
  } else {
    // No seller, set visibility to false
    this.isVisible = false;
  }
  
  next();
});

// Post-save middleware: Update isVisible based on seller verification + product state.
// This runs after saves/updates (including findByIdAndUpdate) to ensure products
// automatically move in/out of buyer visibility when either the seller or the
// product itself changes. It mirrors the same rules as the pre-save hook.
productSchema.post('save', async function (doc) {
  // Only update if seller is populated or we can fetch it
  if (doc.seller && mongoose.Types.ObjectId.isValid(doc.seller)) {
    try {
      const Seller = mongoose.model('Seller');
      const seller = await Seller.findById(doc.seller);
      
      if (seller) {
        const isSellerVerified = seller.verificationStatus === 'verified';
        const shouldBeVisible =
          isSellerVerified &&
          (doc.status === 'active' || doc.status === 'out_of_stock') &&
          doc.moderationStatus === 'approved' &&
          !doc.isDeleted && !doc.isDeletedByAdmin && !doc.isDeletedBySeller;
        
        // Only update if visibility needs to change (avoid infinite loop)
        if (doc.isVisible !== shouldBeVisible) {
          await mongoose.model('Product').findByIdAndUpdate(
            doc._id,
            { isVisible: shouldBeVisible },
            { runValidators: false } // Skip validators to avoid triggering save again
          );
          
          if (process.env.NODE_ENV === 'development') {
            console.log('[Product Post-Save] Visibility corrected:', {
              productId: doc._id,
              wasVisible: doc.isVisible,
              shouldBeVisible,
            });
          }
        }
      }
    } catch (error) {
      // Don't fail product save if visibility update fails
      console.error('[Product Post-Save] Error updating visibility:', error);
    }
  }
});

// Virtual populate
productSchema.virtual('reviews', {
  ref: 'Review',
  foreignField: 'product',
  localField: '_id',
});

// Virtuals
productSchema.virtual('id').get(function () {
  return this._id ? this._id.toHexString() : null;
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

// Tax calculation virtuals (Ghana GRA VAT-inclusive pricing)
// Price entered by seller is VAT-inclusive (includes 15% VAT)
productSchema.virtual('taxBreakdown').get(function () {
  const taxService = require('../../services/tax/taxService');
  const price = this.defaultPrice || 0;
  return taxService.extractTaxFromPrice(price);
});

// Get base price before VAT for a specific variant
productSchema.methods.getVariantTaxBreakdown = function (variantIndex) {
  const taxService = require('../../services/tax/taxService');
const logger = require('../../utils/logger');
  const variant = this.variants?.[variantIndex];
  if (!variant) return null;
  return taxService.extractTaxFromPrice(variant.price || 0);
};

// Method to apply discounts to a product
productSchema.methods.applyDiscounts = async function () {
  logger.info('applyDiscounts called');
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
  logger.info(discounts);
  // Track if any discount was applied
  let discountApplied = false;
  // logger.info('variants', this.variants);
  // Apply the best discount to each variant
  for (let i = 0; i < this.variants.length; i++) {
    let bestDiscountedPrice = this.variants[i].price;
    // logger.info('bestDiscountedPrice', bestDiscountedPrice);
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
      // logger.info('discountedPrice', discountedPrice);
      // Track the best discount (lowest price)
      if (discountedPrice < bestDiscountedPrice) {
        bestDiscountedPrice = discountedPrice;
        // logger.info('bestDiscountedPrice', bestDiscountedPrice);
        bestDiscount = discount;
        // logger.info('bestDiscount', bestDiscount);
      }
    }

    // Apply the best discount if found
    if (bestDiscount) {
      this.variants[i].price = Math.round(bestDiscountedPrice * 100) / 100;
      // Round to 2 decimal places
      // logger.info('variant price', this.variants[i].price);
      discountApplied = true;
    } else {
      // Reset to original price if no discount applies
      this.variants[i].price = this.variants[i].originalPrice;
    }
  }

  // Update min and max prices
  const prices = this.variants
    .map((v) => v.price)
    .filter((p) => p != null && !isNaN(p) && isFinite(p));
  if (prices.length > 0) {
    this.minPrice = Math.min(...prices);
    this.maxPrice = Math.max(...prices);
  }
  logger.info('discountApplied', discountApplied);
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
    const prices = this.variants
      .map((v) => v.price)
      .filter((p) => p != null && !isNaN(p) && isFinite(p));
    if (prices.length > 0) {
      this.minPrice = Math.min(...prices);
      this.maxPrice = Math.max(...prices);
    }
  }

  return changesMade;
};

// Middleware
productSchema.pre('validate', function (next) {
  try {
    // Ensure variants is an array (handle undefined/null)
    const variants = Array.isArray(this.variants) ? this.variants : [];
    
    // CRITICAL: Set main product price from first variant BEFORE validation
    // This ensures the required price field is satisfied
    if ((!this.price || this.price === 0) && variants.length > 0) {
      const firstVariantPrice = parseFloat(variants[0]?.price) || 0;
      if (firstVariantPrice > 0) {
        this.price = firstVariantPrice;
      }
    }
    
    // Validate variants exist (only validate if variants is explicitly provided)
    // For new documents, variants should be provided
    // For updates, only validate if variants field is being modified
    const isNewDocument = this.isNew;
    const isVariantsModified = this.isModified('variants');
    
    // Only validate variants if:
    // 1. It's a new document (variants should be provided)
    // 2. OR variants field is being modified (explicitly set)
    if ((isNewDocument || isVariantsModified) && variants.length === 0) {
      this.invalidate('variants', 'Product must have at least one variant');
      return next(); // Stop validation early
    }

    // Validate that each variant has at least one attribute
    // Only validate if variants array exists and has items
    if (variants.length > 0) {
      variants.forEach((variant, index) => {
        if (!variant || typeof variant !== 'object') {
          this.invalidate(
            `variants.${index}`,
            'Variant must be a valid object',
          );
          return;
        }
        
        if (!variant.attributes || !Array.isArray(variant.attributes) || variant.attributes.length === 0) {
          this.invalidate(
            `variants.${index}`,
            'Variant must have at least one attribute',
          );
        }
        
        // Validate variant price is set
        const variantPrice = parseFloat(variant.price) || 0;
        if (!variant.price || variantPrice <= 0) {
          this.invalidate(
            `variants.${index}.price`,
            'Variant price is required and must be greater than 0',
          );
        }
      });
    }
  } catch (error) {
    // Log error but don't fail validation - let Mongoose handle it
    console.error('[Product Pre-Validate] Error in validation:', error);
    // Don't call next(error) - let validation continue
  }

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

// Post-save middleware to maintain category-product relationship
productSchema.post('save', async function (doc) {
  const Category = mongoose.model('Category');
  
  try {
    // Add product to subCategory's products array if it exists
    if (doc.subCategory) {
      await Category.findByIdAndUpdate(
        doc.subCategory,
        { $addToSet: { products: doc._id } }, // $addToSet prevents duplicates
        { new: true }
      );
    }
    
    // Also add to parentCategory's products array if it exists
    if (doc.parentCategory) {
      await Category.findByIdAndUpdate(
        doc.parentCategory,
        { $addToSet: { products: doc._id } }, // $addToSet prevents duplicates
        { new: true }
      );
    }
  } catch (error) {
    logger.error('Error updating category products array:', error);
    // Don't throw error to prevent blocking product save
  }
});

// Pre-save middleware to handle category changes
productSchema.pre('save', async function (next) {
  // Only run if category fields are being modified and product already exists
  if (!this.isNew && this._id && (this.isModified('parentCategory') || this.isModified('subCategory'))) {
    const Category = mongoose.model('Category');
    
    try {
      // Get the original document
      const originalDoc = await this.constructor.findById(this._id);
      
      if (originalDoc) {
        // Remove from old categories
        if (originalDoc.subCategory && originalDoc.subCategory.toString() !== this.subCategory?.toString()) {
          await Category.findByIdAndUpdate(
            originalDoc.subCategory,
            { $pull: { products: this._id } }
          );
        }
        
        if (originalDoc.parentCategory && originalDoc.parentCategory.toString() !== this.parentCategory?.toString()) {
          await Category.findByIdAndUpdate(
            originalDoc.parentCategory,
            { $pull: { products: this._id } }
          );
        }
      }
    } catch (error) {
      logger.error('Error removing product from old categories:', error);
      // Continue with save even if this fails
    }
  }
  
  next();
});

// Post-remove middleware to remove product from categories
productSchema.post(['findOneAndDelete', 'findOneAndRemove', 'remove'], async function (doc) {
  const product = doc || this;
  
  if (product) {
    const Category = mongoose.model('Category');
    
    try {
      // Remove from subCategory
      if (product.subCategory) {
        await Category.findByIdAndUpdate(
          product.subCategory,
          { $pull: { products: product._id } }
        );
      }
      
      // Remove from parentCategory
      if (product.parentCategory) {
        await Category.findByIdAndUpdate(
          product.parentCategory,
          { $pull: { products: product._id } }
        );
      }
    } catch (error) {
      logger.error('Error removing product from categories on delete:', error);
    }
  }
});

// Also handle deleteOne
productSchema.post('deleteOne', async function () {
  const productId = this.getQuery()._id;
  
  if (productId) {
    const Category = mongoose.model('Category');
    const Product = mongoose.model('Product');
    
    try {
      const product = await Product.findById(productId);
      if (product) {
        // Remove from subCategory
        if (product.subCategory) {
          await Category.findByIdAndUpdate(
            product.subCategory,
            { $pull: { products: productId } }
          );
        }
        
        // Remove from parentCategory
        if (product.parentCategory) {
          await Category.findByIdAndUpdate(
            product.parentCategory,
            { $pull: { products: productId } }
          );
        }
      }
    } catch (error) {
      logger.error('Error removing product from categories on deleteOne:', error);
    }
  }
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
// PERFORMANCE FIX: Compound index for category-counts aggregation
// This index helps the $group stage in getProductCountByCategory
productSchema.index({ parentCategory: 1, subCategory: 1 });
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
// Index for buyer queries: isVisible + status + moderationStatus
productSchema.index({ isVisible: 1, status: 1, moderationStatus: 1 });
// Compound index for seller verification filtering
productSchema.index({ seller: 1, isVisible: 1, status: 1 });

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

module.exports = Product;;
