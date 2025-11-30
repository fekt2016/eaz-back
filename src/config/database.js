const mongoose = require('mongoose');

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
    console.log('Connected to MongoDB successfully');

    const dbHost = mongoose.connection.host;
    const dbName = mongoose.connection.name;
    console.log(`MongoDB Host: ${dbHost}, Database: ${dbName}`);

    // Handle connection events for better error handling
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
    });

    return true;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error.message);
    throw error;
  }
};

module.exports = connectDatabase;

