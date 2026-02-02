const mongoose = require('mongoose');
const slugify = require('slugify');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: String,
    description: String,
    image: {
      type: String,
      default:
        'https://res.cloudinary.com/dz2xqjv8q/image/upload/v1698247967/eazworld/1_1_dk0l6h.jpg',
    },
    // Replaced attributeTemplates with direct attribute definitions
    attributes: [
      {
        name: { type: String, required: true },
        type: {
          type: String,
          enum: ['text', 'number', 'boolean', 'enum', 'color'],
          default: 'text',
        },
        values: [String], // For enum and color types
        isRequired: { type: Boolean, default: false },
        isFilterable: { type: Boolean, default: false },
        isVariant: { type: Boolean, default: false },
      },
    ],
    parentCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    subcategories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
      },
    ],
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    // Removed isSubcategory field since we can derive it from parentCategory
    // Removed variantStructure and options fields since we're using attributes
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Virtual field for product count
categorySchema.virtual('productCount').get(function () {
  return this.products ? this.products.length : 0;
});

// Virtual field to check if category is a subcategory
categorySchema.virtual('isSubcategory').get(function () {
  return !!this.parentCategory;
});
categorySchema.pre('save', function (next) {
  // If the category is top-level (no parent) and it has attributes
  if (!this.parentCategory && this.attributes && this.attributes.length > 0) {
    return next(
      new Error(
        'Attributes can only be defined for subcategories. Top-level categories cannot have attributes.',
      ),
    );
  }
  next();
});

// Auto-update parent's subcategories array
categorySchema.post('save', async function (doc) {
  if (doc.parentCategory) {
    await mongoose
      .model('Category')
      .findByIdAndUpdate(
        doc.parentCategory,
        { $addToSet: { subcategories: doc._id } },
        { new: true },
      );
  }
});

// Generate slug before saving
categorySchema.pre('save', function (next) {
  this.slug = slugify(this.name, { lower: true });
  next();
});

// Validation for attributes
categorySchema.pre('save', function (next) {
  if (this.attributes && this.attributes.length > 0) {
    for (const attribute of this.attributes) {
      // Validate enum/color attributes require values
      if (
        (attribute.type === 'enum' || attribute.type === 'color') &&
        (!attribute.values || attribute.values.length === 0)
      ) {
        return next(
          new Error(`${attribute.name} requires values for enum/color types`),
        );
      }

      // Validate values are unique
      if (attribute.values && attribute.values.length > 0) {
        const uniqueValues = [
          ...new Set(attribute.values.map((v) => v.toLowerCase())),
        ];
        if (uniqueValues.length !== attribute.values.length) {
          return next(new Error(`${attribute.name} has duplicate values`));
        }
      }
    }
  }
  next();
});

// Cascade delete subcategories when parent is deleted
categorySchema.pre('remove', async function (next) {
  // Remove this category from its parent's subcategories
  if (this.parentCategory) {
    await mongoose.model('Category').findByIdAndUpdate(this.parentCategory, {
      $pull: { subcategories: this._id },
    });
  }

  // Delete all subcategories
  if (this.subcategories.length > 0) {
    await mongoose.model('Category').deleteMany({
      _id: { $in: this.subcategories },
    });
  }

  // Remove this category from all products
  await mongoose
    .model('Product')
    .updateMany({ category: this._id }, { $unset: { category: 1 } });

  next();
});

categorySchema.pre('find', function () {
  this.populate('parentCategory');
});

categorySchema.pre('findOne', function () {
  this.populate('parentCategory');
});

// Indexes for slug lookup, tree queries, and filtering
categorySchema.index({ slug: 1 }, { unique: true });
categorySchema.index({ parentCategory: 1 });
categorySchema.index({ status: 1 });

const Category = mongoose.model('Category', categorySchema);
module.exports = Category;;
