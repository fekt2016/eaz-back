const mongoose = require('mongoose');
const Cart = require('../src/models/product/cartModel');
require('dotenv').config({ path: '.env' });

const mongodb = process.env.MONGO_URL.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD,
);

mongoose.connect(mongodb).then(async () => {
  console.log('Connected to MongoDB Atlas');
  const ObjectIds = mongoose.Types.ObjectId;
  const carts = await Cart.find({});
  let editedCount = 0;

  for (const cart of carts) {
    if (cart.products && cart.products.length) {
      let needsSave = false;
      for (const item of cart.products) {
        if (typeof item.variant === 'string' && (item.variant.includes('{') || item.variant.includes('['))) {
          // Attempt to extract the true ID if possible
          const match = item.variant.match(/_id:\s*(?:new ObjectId\()?['"]?([0-9a-fA-F]{24})/);
          if (match && match[1] && ObjectIds.isValid(match[1])) {
            item.variant = match[1];
          } else {
            item.variant = undefined;
          }
          needsSave = true;
        }
      }
      if (needsSave) {
        cart.markModified('products');
        await cart.save();
        editedCount++;
      }
    }
  }
  console.log(`Done cleaning carts. Fixed ${editedCount} carts.`);
  process.exit(0);
}).catch(err => {
  console.error("Connection error:", err);
  process.exit(1);
});
