// // utils/anonymizeUser.js
// const User = require('../../models/user/userModel');

// module.exports = async (userId) => {
//   try {
//     const anonymizedEmail = `deleted-${userId}@example.com`;

//     await User.findByIdAndUpdate(userId, {
//       $set: {
//         name: 'Deleted User',
//         email: anonymizedEmail,
//         phone: null,
//         address: null,
//         profileImage: null,
//         // Add other fields to anonymize
//         socialLinks: [],
//         paymentMethods: [],
//         billingInfo: null,
//       },
//       $unset: {
//         passwordResetToken: 1,
//         passwordResetExpires: 1,
//         refreshToken: 1,
//       },
//     });
//   } catch (error) {
//     throw new Error(`Anonymization failed: ${error.message}`);
//   }
// };
const User = require('../../models/user/userModel');
const Order = require('../../models/order/orderModel');
const Review = require('../../models/product/reviewModel');

module.exports = async (userId) => {
  try {
    const anonymizedId = `deleted_${crypto.randomBytes(8).toString('hex')}`;
    const anonymizedEmail = `${anonymizedId}@deleted.example`;

    // Anonymize user data
    await User.findByIdAndUpdate(userId, {
      $set: {
        name: 'Deleted User',
        email: anonymizedEmail,
        phone: null,
        address: null,
        profileImage: null,
        socialLinks: [],
      },
      $unset: {
        passwordResetToken: 1,
        passwordResetExpires: 1,
        refreshToken: 1,
        fcmTokens: 1,
      },
    });

    // Anonymize related data
    await Order.updateMany(
      { user: userId },
      {
        $set: { user: anonymizedId },
      },
    );

    await Review.updateMany(
      { user: userId },
      {
        $set: { user: 'Anonymous' },
      },
    );
  } catch (error) {
    throw new Error(`Anonymization failed: ${error.message}`);
  }
};
