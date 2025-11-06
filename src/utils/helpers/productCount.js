const Seller = require('../../models/user/sellerModel');
const Product = require('../../models/product/productModel');

exports.productCount = async function initProductCounts() {
  const sellers = await Seller.find();

  for (const seller of sellers) {
    const count = await Product.countDocuments({ seller: seller._id });
    seller.productCount = count;
    await seller.save();
  }

  console.log('Product counts initialized');
};
initProductCounts();
