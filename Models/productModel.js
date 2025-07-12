const mongoose = require('mongoose');
const slugify = require('slugify');

const productSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
    name: {
      type: String,
      required: [true, 'name is required'],
    },
    slug: String,
    description: { type: String, required: [true, 'description is required'] },
    // detailDescription: { type: String },
    price: Number,
    priceDiscount: {
      type: Number,
      validate: {
        validator: function (val) {
          return val < this.price;
        },
        message: 'Discount price ({val}) should be below regular price',
      },
    },
    imageCover: { type: String, required: [true, 'imageCover is required'] },
    images: [{ type: String }],
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
    ratingsAverage: {
      type: Number,
      default: 4.5,
      min: [1, 'Rating must be above 1.0'],
      max: [5, 'Rating must be below 5.0'],
      set: (val) => Math.round(val * 10) / 10,
    },
    ratingsQuantity: {
      type: Number,
      default: 0,
    },
    variants: Array,
    attributes: { type: Object },
    brand: { type: String },
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
    totalStock: Number,
    totalSold: {
      type: Number,
      default: 0,
    },

    totalViews: {
      type: Number,
      default: 0,
    },
    totalRatings: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'outOfStock'],
      default: 'active',
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
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);
// Virtual populate
productSchema.virtual('reviews', {
  ref: 'Review',
  foreignField: 'product',
  localField: '_id',
});
productSchema.pre('save', function (next) {
  this.slug = slugify(this.name, { lower: true });
  next();
});

productSchema.virtual('id').get(function () {
  return this._id.toHexString();
});
productSchema.index(
  {
    name: 'text',
    parentCategory: 'text',
    subCategory: 'text',
    specifications: 'text',
    variants: 'text',

    description: 'text',
    brand: 'text',
  },
  {
    weights: {
      name: 5,
      parentCategory: 2,
      subCategory: 2,
      specifications: 1,
      variants: 1,
      description: 1,
      brand: 1,
    },
  },
);

productSchema.set('toJSON', { virtuals: true });
const Product = mongoose.model('Product', productSchema);

module.exports = Product;
