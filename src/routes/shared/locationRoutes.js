const express = require('express');
const router = express.Router();
const locationController = require('../../controllers/shared/locationController');
const authController = require('../../controllers/buyer/authController');

// Convert GPS coordinates to digital address
router.get(
  '/convert-coordinates',
  authController.protect,
  authController.restrictTo('user'),
  locationController.convertCoordinatesToDigitalAddress
);

// Reverse geocode GPS coordinates to physical address
router.get(
  '/reverse-geocode',
  authController.protect,
  authController.restrictTo('user'),
  locationController.reverseGeocode
);

// Lookup full address details from digital address
router.post(
  '/lookup-digital-address',
  authController.protect,
  authController.restrictTo('user'),
  locationController.lookupDigitalAddressFull
);

// Hybrid location lookup (GPS + GhanaPostGPS + Google Maps)
router.get(
  '/hybrid-lookup',
  authController.protect,
  authController.restrictTo('user'),
  locationController.hybridLocationLookup
);

// Reverse geocode using Google Maps API
router.post(
  '/reverse-geocode',
  authController.protect,
  authController.restrictTo('user'),
  locationController.reverseGeocode
);

// Hybrid address lookup (supports digital address or GPS coordinates)
router.post(
  '/lookup',
  authController.protect,
  authController.restrictTo('user'),
  locationController.lookupAddress
);

// Full location resolution (GPS → Digital Address + Google Maps)
router.post(
  '/full-location',
  authController.protect,
  authController.restrictTo('user'),
  locationController.fullLocation
);

// Get location from GPS coordinates (Google Maps only)
router.post(
  '/from-gps',
  authController.protect,
  authController.restrictTo('user'),
  locationController.getLocationFromGPS
);

module.exports = router;

