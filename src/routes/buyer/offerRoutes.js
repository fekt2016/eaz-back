const express = require('express');
const promoController = require('../../controllers/buyer/promoController');

const router = express.Router();

router.get('/:id/products', promoController.getPublicPromoProducts);
router.get('/:id', promoController.getPublicPromoById);

module.exports = router;
