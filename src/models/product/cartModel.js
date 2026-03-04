const mongoose = require('mongoose');
const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    products: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        quantity: { type: Number, default: 1 },
        variant: String,
      },
    ],
    totalPrice: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Update calculateTotal method
cartSchema.statics.calculateTotal = async function (cart) {
  // Use populate if available, otherwise find manually
  const productIds = cart.products.map((item) => item.product);
  const products = await mongoose.model('Product').find({
    _id: { $in: productIds },
  });

  return cart.products.reduce((acc, item) => {
    const product = products.find((p) => String(p._id) === String(item.product));
    if (!product) return acc;

    let unitPrice = 0;
    const variantId = item.variant; // This is the ID string

    if (variantId && Array.isArray(product.variants)) {
      const variant = product.variants.find(v => String(v._id) === String(variantId));
      if (variant) {
        unitPrice = variant.priceInclVat ?? variant.price ?? 0;
      } else {
        unitPrice = product.priceInclVat ?? product.price ?? 0;
      }
    } else {
      unitPrice = product.priceInclVat ?? product.price ?? 0;
    }

    return acc + (unitPrice * item.quantity);
  }, 0);
};

// Pre-save hook
cartSchema.pre('save', async function (next) {
  if (this.isModified('products')) {
    this.totalPrice = await this.constructor.calculateTotal(this);
  }
  next();
});

// Index for lookup by user (one cart per user)
cartSchema.index({ user: 1 });

const Cart = mongoose.model('Cart', cartSchema);

module.exports = Cart;;
