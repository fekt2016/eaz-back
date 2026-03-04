const mongoose = require('mongoose');
const Cart = require('../src/models/product/cartModel');
require('dotenv').config({ path: '.env' });

const mongodb = process.env.MONGO_URL.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD,
);

mongoose.connect(mongodb).then(async () => {
  const carts = await Cart.find({});
  for (const cart of carts) {
    if (cart.products && cart.products.length) {
      for (const item of cart.products) {
        if (item.variant) {
          console.log(typeof item.variant);
          console.log(item.variant);
          console.log("Includes {: ", item.variant.includes('{'));
        }
      }
    }
  }
  process.exit(0);
});
