const mongoose = require('mongoose');
// Ensure Variant model is registered before using it as a reference
// Note: Variant model is optional - variants are now identified by SKU
require('../product/variantModel');

/**
 * OrderItem Schema
 * 
 * IMPORTANT: This schema represents a SNAPSHOT of the product/variant at order time.
 * Fields like productName, sku, and variantAttributes are stored to ensure
 * order history remains accurate even if products are later modified or deleted.
 * 
 * VARIANT HANDLING:
 * - variant field MUST be an ObjectId (or null), NEVER a full object
 * - Pre-save hook normalizes variant to ensure it's always ObjectId or null
 * - This prevents "Variant not found" errors during stock validation
 */
const OrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    comment: 'Reference to Product - used for stock updates and product details',
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: 'Quantity must be a whole number',
    },
  },
  /**
   * Variant ID - CRITICAL: Must be ObjectId or null, never a full object
   * 
   * This field stores ONLY the variant ID (ObjectId reference).
   * The pre-save hook ensures any object passed is normalized to just the ID.
   * 
   * For variant products: Stores the specific variant ID that was ordered
   * For simple products: null (no variant)
   * 
   * DO NOT store full variant objects here - causes stock validation failures
   */
  variant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Variant',
    default: null,
    // Custom validator to ensure variant is ObjectId or null
    validate: {
      validator: function(value) {
        // Allow null for simple products
        if (value === null || value === undefined) return true;
        // Must be a valid ObjectId
        return mongoose.Types.ObjectId.isValid(value);
      },
      message: 'Variant must be a valid ObjectId or null',
    },
    comment: 'Variant ID (ObjectId) for variant products, null for simple products. NEVER store full variant objects.',
  },
  /**
   * SNAPSHOT FIELDS - Store product/variant details at order time
   * These fields ensure order history remains accurate even if products change
   * 
   * IMPORTANT: These are populated during order creation from the product/variant
   * at that moment. They should NOT be updated after order creation.
   */
  productName: {
    type: String,
    comment: 'Product name at time of order (snapshot for order history)',
  },
  productImage: {
    type: String,
    comment: 'Product image URL at time of order (snapshot)',
  },
  /**
   * SKU - PRIMARY IDENTIFIER for variant/product
   * 
   * CRITICAL: This is the single source of truth for identifying what was ordered.
   * - For variant products: Stores the variant SKU
   * - For simple products: Stores the product SKU (or first variant SKU if available)
   * 
   * Variant lookup is done by SKU, NOT by variantId.
   * This eliminates "Variant not found" errors and makes inventory management simpler.
   * 
   * REQUIRED: Must be provided during order creation
   */
  sku: {
    type: String,
    required: [true, 'SKU is required for order items'],
    trim: true,
    uppercase: true,
    comment: 'Product or variant SKU at time of order (snapshot). PRIMARY identifier for variant lookup.',
  },
  variantAttributes: [{
    key: {
      type: String,
      comment: 'Attribute key (e.g., "Color", "Size")',
    },
    value: {
      type: String,
      comment: 'Attribute value (e.g., "Red", "Large")',
    },
  }],
  variantName: {
    type: String,
    comment: 'Variant name/description at time of order (snapshot)',
  },
  
  /**
   * PRICING FIELDS
   * All prices are stored as snapshots at order time
   */
  price: {
    type: Number,
    required: true,
    min: 0,
    comment: 'VAT-inclusive price per unit at time of order (snapshot)',
  },
  // Tax breakdown fields (computed from price)
  basePrice: {
    type: Number,
    default: 0,
    comment: 'Price before VAT (seller revenue)',
  },
  vat: {
    type: Number,
    default: 0,
    comment: 'VAT amount (12.5%)',
  },
  nhil: {
    type: Number,
    default: 0,
    comment: 'NHIL amount (2.5%)',
  },
  getfund: {
    type: Number,
    default: 0,
    comment: 'GETFund amount (2.5%)',
  },
  covidLevy: {
    type: Number,
    default: 0,
    comment: 'COVID levy (1% on base price)',
  },
  totalTaxes: {
    type: Number,
    default: 0,
    comment: 'Total of all taxes (VAT + NHIL + GETFund + COVID levy)',
  },
  isVATInclusive: {
    type: Boolean,
    default: true,
    comment: 'Price includes 15% VAT (VAT + NHIL + GETFund)',
  },
  // Item-level refund fields
  refundStatus: {
    type: String,
    enum: ['none', 'requested', 'seller_review', 'admin_review', 'approved', 'rejected'],
    default: 'none',
  },
  refundRequestedQty: {
    type: Number,
    default: 0,
    min: 0,
    comment: 'Quantity requested for refund',
  },
  refundApprovedQty: {
    type: Number,
    default: 0,
    min: 0,
    comment: 'Quantity approved for refund',
  },
  refundReason: {
    type: String,
    enum: [
      'defective_product',
      'wrong_item',
      'not_as_described',
      'damaged_during_shipping',
      'late_delivery',
      'changed_mind',
      'duplicate_order',
      'other',
    ],
  },
  refundReasonText: {
    type: String,
    maxlength: 500,
  },
  refundImages: [{
    type: String,
    comment: 'URLs to refund-related images',
  }],
  refundAmount: {
    type: Number,
    default: 0,
    min: 0,
    comment: 'Refund amount for this item (can be partial)',
  },
  refundSellerNote: {
    type: String,
    maxlength: 500,
    comment: 'Seller notes on the refund request',
  },
  refundAdminNote: {
    type: String,
    maxlength: 500,
    comment: 'Admin internal notes on the refund',
  },
  refundRequestedAt: {
    type: Date,
  },
  refundApprovedAt: {
    type: Date,
  },
  refundProcessedBy: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'refundProcessedByModel',
  },
  refundProcessedByModel: {
    type: String,
    enum: ['Admin', 'Seller'],
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Seller',
    comment: 'Seller who sold this item (for item-level refund tracking)',
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt
  // Ensure strict mode - don't allow fields not in schema
  strict: true,
});

/**
 * PRE-SAVE HOOK: Normalize variant field and validate SKU
 * 
 * CRITICAL: 
 * - SKU is the PRIMARY identifier for variant lookup
 * - Variant field is kept for backward compatibility but SKU is preferred
 * - This ensures variant is ALWAYS stored as ObjectId or null, never as a full object
 */
OrderItemSchema.pre('save', function(next) {
  // CRITICAL: Ensure SKU is uppercase (matching variant SKU format)
  if (this.sku) {
    this.sku = this.sku.trim().toUpperCase();
  }
  
  // Normalize variant field - ensure it's ObjectId or null (backward compatibility)
  if (this.variant) {
    // If variant is an object, extract _id
    if (typeof this.variant === 'object' && this.variant !== null && !(this.variant instanceof mongoose.Types.ObjectId)) {
      // Extract _id from object
      const variantId = this.variant._id || this.variant.id || null;
      if (variantId) {
        // Convert to ObjectId if it's a string
        this.variant = mongoose.Types.ObjectId.isValid(variantId) 
          ? new mongoose.Types.ObjectId(variantId) 
          : null;
      } else {
        // No _id found in object - set to null
        this.variant = null;
      }
    } else if (typeof this.variant === 'string') {
      // If variant is a string, convert to ObjectId if valid
      this.variant = mongoose.Types.ObjectId.isValid(this.variant)
        ? new mongoose.Types.ObjectId(this.variant)
        : null;
    }
    // If already ObjectId, keep as is
  } else {
    // Ensure null for simple products
    this.variant = null;
  }
  
  next();
});

/**
 * PRE-VALIDATE HOOK: Additional validation
 * Ensures data integrity before saving
 */
OrderItemSchema.pre('validate', function(next) {
  // Ensure quantity is a positive integer
  if (this.quantity && (!Number.isInteger(this.quantity) || this.quantity < 1)) {
    return next(new Error('Quantity must be a positive integer'));
  }
  
  // Ensure price is non-negative
  if (this.price !== undefined && this.price < 0) {
    return next(new Error('Price must be non-negative'));
  }
  
  next();
});

/**
 * INSTANCE METHOD: Get display name for order history
 * Combines product name with variant attributes if available
 */
OrderItemSchema.methods.getDisplayName = function() {
  if (this.productName) {
    if (this.variantAttributes && this.variantAttributes.length > 0) {
      const attrs = this.variantAttributes.map(attr => `${attr.key}: ${attr.value}`).join(', ');
      return `${this.productName} (${attrs})`;
    }
    return this.productName;
  }
  return 'Product';
};

const OrderItems = mongoose.model('OrderItems', OrderItemSchema);

module.exports = OrderItems;
