const mongoose = require('mongoose');
const logger = require('../utils/logger');

// One-time safety migration:
// Fix legacy unique index on Creditbalance.admin that causes E11000 when admin is null.
// - Old index: { admin: 1 } unique → breaks when many user wallets have admin: null
// - New index: unique only when admin is an ObjectId (partial index)
const ensureCreditbalanceAdminIndex = async () => {
  try {
    const Creditbalance = require('../models/user/creditbalanceModel');

    // If any documents stored admin explicitly as null, unset it so it doesn't get indexed.
    // (partial index also excludes null, but the legacy unique index does not)
    await Creditbalance.collection.updateMany(
      { admin: null },
      { $unset: { admin: '' } },
    );

    // Drop legacy unique index if it exists (usually named "admin_1")
    const indexes = await Creditbalance.collection.indexes();
    const legacy = indexes.find(
      (idx) =>
        idx?.name === 'admin_1' &&
        idx?.unique === true &&
        idx?.key?.admin === 1 &&
        !idx?.partialFilterExpression,
    );

    if (legacy) {
      logger.warn('[DB] Dropping legacy Creditbalance admin_1 unique index');
      await Creditbalance.collection.dropIndex('admin_1');
    }

    // Ensure correct partial unique index exists
    await Creditbalance.collection.createIndex(
      { admin: 1 },
      {
        unique: true,
        partialFilterExpression: { admin: { $type: 'objectId' } },
        name: 'admin_1',
      },
    );
  } catch (error) {
    // Non-fatal: app can still run; this only impacts wallet creation in rare cases
    logger.warn('[DB] Creditbalance admin index check failed', {
      message: error?.message,
    });
  }
};

const connectDatabase = async () => {
  try {
    const mongodb = process.env.MONGO_URL.replace(
      '<PASSWORD>',
      process.env.DATABASE_PASSWORD,
    );

    // Connection options for better memory management and performance
    const connectionOptions = {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      minPoolSize: 2, // Maintain at least 2 socket connections
      serverSelectionTimeoutMS: 5000, // How long to try selecting a server
      socketTimeoutMS: 45000, // How long a send or receive on a socket can take before timeout
      family: 4, // Use IPv4, skip trying IPv6
    };

    await mongoose.connect(mongodb, connectionOptions);
    logger.info('Connected to MongoDB successfully');

    const dbHost = mongoose.connection.host;
    const dbName = mongoose.connection.name;
    logger.info('MongoDB connection details', { host: dbHost, database: dbName });

    // Handle connection events for better error handling
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error', { error: err.message, stack: err.stack });
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });

    // Run small migrations after connection is established
    await ensureCreditbalanceAdminIndex();

    return true;
  } catch (error) {
    logger.error('Error connecting to MongoDB', { error: error.message, stack: error.stack });
    throw error;
  }
};

module.exports = connectDatabase;

