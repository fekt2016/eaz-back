const express = require('express');
const {
  getPermissions,
  updateEmailPrefs,
  updateSMSPrefs,
  updateDataSharing,
  updateLocationAccess,
  updateSocialSharing,
  updateAccountVisibility,
  requestDataDownload,
  requestAccountDeletion,
  cancelAccountDeletion,
} = require('../../controllers/buyer/permissionController');
const authController = require('../../controllers/buyer/authController');

const router = express.Router();

router.use(authController.protect, authController.restrictTo('user'));

router.get('/', getPermissions);
router.patch('/email', updateEmailPrefs);
router.patch('/sms', updateSMSPrefs);
router.patch('/data-sharing', updateDataSharing);
router.patch('/location', updateLocationAccess);
router.patch('/social', updateSocialSharing);
router.patch('/visibility', updateAccountVisibility);
router.post('/download-data', requestDataDownload);
router.post('/request-deletion', requestAccountDeletion);
router.post('/cancel-deletion', cancelAccountDeletion);

module.exports = router;
