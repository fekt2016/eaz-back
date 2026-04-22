const express = require('express');
const router = express.Router();

const deprecatedHandler = (req, res) => {
  res.status(410).json({
    status: 'fail',
    message:
      'This endpoint has been deprecated. Discounts and coupons are now managed centrally via admin Promos. See /api/v1/seller/promos/active.',
    deprecated: true,
    migratedTo: '/api/v1/seller/promos',
  });
};

router.all('*', deprecatedHandler);

module.exports = router;
