const User = require('../../models/user/userModel');
const { sendAccountDeletionConfirmation } = require('../email/emailService');

exports.processScheduledDeletions = async () => {
  try {
    const now = new Date();

    // Find users with pending deletions that are due
    const users = await User.find({
      'accountDeletion.status': 'pending',
      'accountDeletion.scheduledAt': { $lte: now },
    });

    console.log(`Processing ${users.length} account deletions`);

    for (const user of users) {
      try {
        console.log(`Deleting account for ${user.email}`);

        // 1. Update deletion status to processing
        user.accountDeletion.status = 'processing';
        await user.save();

        // 2. Perform actual deletion/anonymization
        await anonymizeUserData(user._id);

        // 3. Send confirmation email
        await sendAccountDeletionConfirmation(user.email);

        // 4. Mark as completed
        user.accountDeletion.status = 'completed';
        user.accountDeletion.completedAt = new Date();
        user.active = false;
        await user.save();
      } catch (error) {
        console.error(`Failed to delete account ${user.email}:`, error);
        user.accountDeletion.status = 'failed';
        await user.save();
      }
    }
  } catch (error) {
    console.error('Account deletion scheduler error:', error);
  }
};

async function anonymizeUserData(userId) {
  // Implement GDPR-compliant data anonymization
  await User.findByIdAndUpdate(userId, {
    $set: {
      name: 'Deleted User',
      email: `deleted-${userId}@example.com`,
      phone: 0,
      address: '',
      password: 'deleted',
      photo: 'default.jpg',
      wishList: null,
      // Add other fields to anonymize
    },
    $unset: {
      passwordResetToken: '',
      passwordResetExpires: '',
      otp: '',
      otpExpires: '',
      // Remove sensitive fields
    },
  });

  // Add additional data cleanup as needed
}
console.log('testing');
