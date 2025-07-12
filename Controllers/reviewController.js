const Review = require('../Models/reviewModel');
const handleFactory = require('../Controllers/handleFactory');

exports.setProductUserIds = (req, res, next) => {
  if (!req.body.product) req.body.product = req.params.productId;
  if (!req.body.user) req.body.user = req.user.id;
  next();
};
exports.getAllReview = handleFactory.getAll(Review);
exports.getReview = handleFactory.getOne(Review, {
  path: 'product',
  select: 'names',
  path: 'user',
  select: 'name photo',
});

exports.createReview = handleFactory.createOne(Review);
exports.updateReview = handleFactory.updateOne(Review);
exports.deleteReview = handleFactory.deleteOne(Review);
