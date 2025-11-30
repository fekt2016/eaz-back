const mongoose = require('mongoose');

const productViewModelSchema = new mongoose.Schema({
  productId: mongoose.Schema.Types.ObjectId,
  sessionId: String, // Unique session identifier
  viewedAt: Date,
});

const ProductView = mongoose.model('ProductViewModel', productViewModelSchema);

module.exports = ProductView;;
