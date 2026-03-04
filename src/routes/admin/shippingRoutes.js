const express = require('express');
const {
    getAllShippingCharges,
    getShippingChargeByOrder,
    getShippingChargesSummary,
    getShippingRate,
    updateShippingRate,
    settleShippingCharge
} = require('../../controllers/admin/shippingController');

const authController = require('../../controllers/buyer/authController');

const router = express.Router();

// Apply protection and restrict to admin/superadmin for all shipping routes
router.use(authController.protect);
router.use(authController.restrictTo('admin', 'superadmin'));

// Summary route must come before /:id routes
router.get('/charges/summary', getShippingChargesSummary);
router.get('/charges', getAllShippingCharges);
router.get('/charges/order/:orderId', getShippingChargeByOrder);
router.patch('/charges/:id/settle', settleShippingCharge);

router.get('/rate', getShippingRate);
router.put('/rate', updateShippingRate);

module.exports = router;
