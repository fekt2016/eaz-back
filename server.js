const mongoose = require('mongoose');
const app = require('./app');
const dotenv = require('dotenv');
dotenv.config({ path: './config.env' });

const mongodb = process.env.MONGO_URL.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD,
);

// Database connection
mongoose
  .connect(mongodb)
  .then(async () => {
    console.log('Connected to MongoDB');

    // Import models AFTER connection is established
    // const User = require('./Models/userModel');
    // const Permission = require('./Models/permissionModel');

    // Run permissions fix
    // await fixPermissions(User, Permission);

    // Start server AFTER migrations
    const port = process.env.PORT || 4000;
    const server = app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });

    // Error handling
    process.on('unhandledRejection', (err) => {
      console.error('UNHANDLED REJECTION! 🔥 Shutting down');
      console.error(err.name, err.message);
      server.close(() => {
        process.exit(1);
      });
    });

    process.on('uncaughtException', (err) => {
      console.error('UNCAUGHT EXCEPTION! 🔥 Shutting down');
      console.error(err.name, err.message);
      server.close(() => {
        process.exit(1);
      });
    });
  })
  .catch((error) => {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1);
  });

// Define fixPermissions function with parameters
async function fixPermissions(User, Permission) {
  try {
    console.log('Starting permission fix...');

    // Find users with duplicate permissions
    const users = await User.aggregate([
      {
        $lookup: {
          from: 'permissions',
          localField: '_id',
          foreignField: 'user',
          as: 'perms',
        },
      },
      {
        $match: {
          'perms.1': { $exists: true }, // Users with >1 permission
        },
      },
    ]);

    console.log(`Found ${users.length} users with duplicate permissions`);

    for (const user of users) {
      try {
        // Keep first permission, delete others
        const [keep, ...duplicates] = user.perms;

        // Update user reference
        await User.findByIdAndUpdate(user._id, { permissions: keep._id });

        // Delete duplicates
        await Permission.deleteMany({
          _id: { $in: duplicates.map((d) => d._id) },
        });

        console.log(`Fixed permissions for user ${user._id}`);
      } catch (innerError) {
        console.error(`Error fixing user ${user._id}:`, innerError.message);
      }
    }

    console.log('Permission fix completed successfully');
  } catch (err) {
    console.error('Permission fix failed:', err);
    throw err; // Rethrow to exit process
  }
}
