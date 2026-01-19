const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../../models/user/userModel');
const Permission = require('../../models/user/permissionModel');
const logger = require('../logger');

dotenv.config();

exports.migratePermissions = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    logger.info('Database connected');

    // Get all existing users
    const users = await User.find({ permissions: { $exists: false } });

    logger.info(`Migrating permissions for ${users.length} users...`);

    for (const user of users) {
      // Create new permission settings with defaults
      const permission = new Permission({
        user: user._id,
        // Add any custom defaults here if needed
      });

      // Save new permission document
      await permission.save();

      // Update user reference
      user.permissions = permission._id;
      await user.save();

      logger.info(`Migrated permissions for user: ${user.email}`);
    }

    logger.info('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed:', error);
    process.exit(1);
  }
};

migratePermissions();
