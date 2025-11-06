const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../../models/user/userModel');
const Permission = require('../../models/user/permissionModel');

dotenv.config();

exports.migratePermissions = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Database connected');

    // Get all existing users
    const users = await User.find({ permissions: { $exists: false } });

    console.log(`Migrating permissions for ${users.length} users...`);

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

      console.log(`Migrated permissions for user: ${user.email}`);
    }

    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

migratePermissions();
