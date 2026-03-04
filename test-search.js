const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });
async function test() {
  const mongoUrl = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
  await mongoose.connect(mongoUrl);
  const Product = require('./src/models/product/productModel');
  const d = await Product.findOne({ name: /iphone 14 pro max/i }).select('name status isVisible moderationStatus seller isDeleted');
  console.log("Product:", d);

  const Seller = require('./src/models/user/sellerModel');
  if (d && d.seller) {
    const s = await Seller.findById(d.seller).select('verificationStatus status shopName');
    console.log("Seller:", s);
  }
  process.exit(0);
}
test();
