const mongonse = require('mongoose');

const followSchema = new mongonse.Schema({
  user: { type: mongonse.Schema.Types.ObjectId, ref: 'User' },
  seller: { type: mongonse.Schema.Types.ObjectId, ref: 'Seller' },
  createdAt: { type: Date, default: Date.now },
});
followSchema.index({ user: 1, seller: 1 }, { unique: true });
const Follow = mongonse.model('Follow', followSchema);
module.exports = Follow;
