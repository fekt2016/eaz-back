const mongoose = require('mongoose');
const logger = require('../utils/logger');

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

    // Replace legacy guestToken unique index (sparse + default null caused E11000 on dup null)
    // and strip stored nulls so partial unique index + upserts work reliably.
    try {
      const ChatConversation = require('../models/chat/chatConversationModel');
      await ChatConversation.syncIndexes();
      const coll = ChatConversation.collection;
      const unsetGuest = await coll.updateMany(
        { guestToken: null },
        { $unset: { guestToken: '' } }
      );
      const unsetGuestParticipant = await coll.updateMany(
        { participantRole: 'guest', participantId: null },
        { $unset: { participantId: '' } }
      );
      if (unsetGuest.modifiedCount || unsetGuestParticipant.modifiedCount) {
        logger.info('ChatConversation legacy null fields cleaned', {
          guestTokenFields: unsetGuest.modifiedCount,
          guestParticipantIdFields: unsetGuestParticipant.modifiedCount,
        });
      }
    } catch (idxErr) {
      logger.warn('ChatConversation index sync / null cleanup', {
        message: idxErr.message,
      });
    }

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

    return true;
  } catch (error) {
    logger.error('Error connecting to MongoDB', { error: error.message, stack: error.stack });
    throw error;
  }
};

module.exports = connectDatabase;

