const express = require('express');
const promoController = require('../../controllers/buyer/promoController');

const router = express.Router();

router.get('/active', promoController.getPublicPromos);
router.get('/public', promoController.getPublicPromos);
router.get('/:id/products', promoController.getPublicPromoProducts);
router.get('/:id', promoController.getPublicPromoById);
router.get('/', promoController.getPublicPromos);

module.exports = router;
