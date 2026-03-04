const catchAsync = require('../../utils/helpers/catchAsync');

/**
 * Public: Get display discount configuration for banners/promo text.
 * GET /api/v1/discount
 * Used by mobile app (useGetDisplayDiscount) and web. No auth required.
 */
exports.getDisplayDiscount = catchAsync(async (req, res) => {
  res.status(200).json({
    status: 'success',
    data: {
      message: null,
      bannerText: null,
    },
  });
});
