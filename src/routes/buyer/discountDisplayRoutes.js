const express = require('express');
const discountDisplayController = require('../../controllers/buyer/discountDisplayController');

const router = express.Router();

router.get('/', discountDisplayController.getDisplayDiscount);

module.exports = router;
