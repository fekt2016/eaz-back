const mongoose = require('mongoose');

const followSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller' },
  createdAt: { type: Date, default: Date.now },
});
followSchema.index({ user: 1, seller: 1 }, { unique: true });
const Follow = mongoose.model('Follow', followSchema);
module.exports = Follow;;
