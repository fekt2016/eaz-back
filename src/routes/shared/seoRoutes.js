const express = require('express');
const seoController = require('../../controllers/shared/seoController');

const router = express.Router();

// Public sitemap endpoint
router.get('/sitemap.xml', seoController.getSitemap);

module.exports = router;
