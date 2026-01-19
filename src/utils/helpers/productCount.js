const Seller = require('../../models/user/sellerModel');
const Product = require('../../models/product/productModel');
const logger = require('../logger');

exports.productCount = async function initProductCounts() {
  const sellers = await Seller.find();

  for (const seller of sellers) {
    const count = await Product.countDocuments({ seller: seller._id });
    seller.productCount = count;
    await seller.save();
  }

  logger.info('Product counts initialized');
};
initProductCounts();
