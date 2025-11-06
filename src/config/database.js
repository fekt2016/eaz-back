const mongoose = require('mongoose');

const connectDatabase = async () => {
  try {
    const mongodb = process.env.MONGO_URL.replace(
      '<PASSWORD>',
      process.env.DATABASE_PASSWORD,
    );

    await mongoose.connect(mongodb);
    console.log('Connected to MongoDB successfully');

    const dbHost = mongoose.connection.host;
    const dbName = mongoose.connection.name;
    console.log(`MongoDB Host: ${dbHost}, Database: ${dbName}`);

    return true;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error.message);
    throw error;
  }
};

module.exports = connectDatabase;

