/**
 * Script to update a user's role to admin
 * 
 * Usage:
 *   node scripts/update-user-to-admin.js <email_or_phone>
 * 
 * Example:
 *   node scripts/update-user-to-admin.js user@example.com
 *   node scripts/update-user-to-admin.js +1234567890
 */

require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const User = require('../src/models/user/userModel');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.DATABASE, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const updateUserToAdmin = async (identifier) => {
  try {
    await connectDB();

    // Find user by email or phone
    let user;
    if (identifier.includes('@')) {
      // Email
      user = await User.findOne({ email: identifier.toLowerCase() });
    } else {
      // Phone number (remove any non-digit characters)
      const phone = identifier.replace(/\D/g, '');
      user = await User.findOne({ phone: parseInt(phone) });
    }

    if (!user) {
      console.error(`❌ User not found with identifier: ${identifier}`);
      process.exit(1);
    }

    console.log(`\n📋 Current User Info:`);
    console.log(`   ID: ${user._id}`);
    console.log(`   Name: ${user.name || 'N/A'}`);
    console.log(`   Email: ${user.email || 'N/A'}`);
    console.log(`   Phone: ${user.phone || 'N/A'}`);
    console.log(`   Current Role: ${user.role}`);

    if (user.role === 'admin') {
      console.log(`\n✅ User is already an admin. No changes needed.`);
      await mongoose.connection.close();
      process.exit(0);
    }

    // Update role to admin
    user.role = 'admin';
    await user.save({ validateBeforeSave: false });

    console.log(`\n✅ Successfully updated user role to 'admin'`);
    console.log(`\n📋 Updated User Info:`);
    console.log(`   ID: ${user._id}`);
    console.log(`   Name: ${user.name || 'N/A'}`);
    console.log(`   Email: ${user.email || 'N/A'}`);
    console.log(`   Phone: ${user.phone || 'N/A'}`);
    console.log(`   New Role: ${user.role}`);

    console.log(`\n💡 Note: User may need to log out and log back in for changes to take effect.`);
    console.log(`   The JWT token contains the role, so a new login is required.\n`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating user:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

// Get identifier from command line arguments
const identifier = process.argv[2];

if (!identifier) {
  console.error('❌ Please provide a user email or phone number');
  console.error('\nUsage:');
  console.error('  node scripts/update-user-to-admin.js <email_or_phone>');
  console.error('\nExamples:');
  console.error('  node scripts/update-user-to-admin.js user@example.com');
  console.error('  node scripts/update-user-to-admin.js +1234567890');
  process.exit(1);
}

updateUserToAdmin(identifier);









