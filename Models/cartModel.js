const mongoose = require('mongoose');
const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    products: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        quantity: { type: Number, default: 1 },
      },
    ],
    totalPrice: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Update calculateTotal method
cartSchema.statics.calculateTotal = async function (cart) {
  // Calculate total without population
  const productIds = cart.products.map((item) => item.product);
  const products = await mongoose.model('Product').find({
    _id: { $in: productIds },
  });

  return cart.products.reduce((acc, item) => {
    const product = products.find((p) => p._id.equals(item.product));
    return acc + (product ? product.price * item.quantity : 0);
  }, 0);
};

// Pre-save hook
cartSchema.pre('save', async function (next) {
  if (this.isModified('products')) {
    this.totalPrice = await this.constructor.calculateTotal(this);
  }
  next();
});
const Cart = mongoose.model('Cart', cartSchema);

module.exports = Cart;
