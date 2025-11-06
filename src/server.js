const mongoose = require('mongoose');
const app = require('./app');
const { validateEnvironment } = require('./config/env');
const connectDatabase = require('./config/database');

// Validate environment variables
validateEnvironment();

// Configuration validation and setup
class Server {
  constructor() {
    this.server = null;
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Graceful shutdown handlers
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));

    // Global error handlers
    process.on('unhandledRejection', this.handleUnhandledRejection.bind(this));
    process.on('uncaughtException', this.handleUncaughtException.bind(this));
  }

  async startServer() {
    try {
      const host =
        process.env.HOST ||
        (process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost');

      const port = process.env.PORT || 4000;

      this.server = app.listen(port, host, () => {
        console.log(
          `Server running in ${process.env.NODE_ENV || 'development'} mode`,
        );
        console.log(`Listening on http://${host}:${port}`);

        if (process.env.NODE_ENV === 'production') {
          console.log('Production server is ready');
        }
      });

      // Handle server errors
      this.server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`Port ${port} is already in use`);
        } else {
          console.error('Server error:', error.message);
        }
        process.exit(1);
      });

      return this.server;
    } catch (error) {
      console.error('Failed to start server:', error.message);
      throw error;
    }
  }

  async gracefulShutdown(signal) {
    console.log(`${signal} received. Shutting down gracefully...`);

    try {
      // Close HTTP server
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(() => {
            console.log('HTTP server closed.');
            resolve();
          });
        });
      }

      // Close MongoDB connection
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close(false);
        console.log('MongoDB connection closed.');
      }

      console.log('Shutdown completed.');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error.message);
      process.exit(1);
    }
  }

  handleUnhandledRejection(err) {
    console.error('UNHANDLED REJECTION! 🔥 Shutting down');
    console.error('Error:', err.name, err.message);

    if (this.server) {
      this.server.close(() => {
        process.exit(1);
      });
    } else {
      process.exit(1);
    }
  }

  handleUncaughtException(err) {
    console.error('UNCAUGHT EXCEPTION! 🔥 Shutting down');
    console.error('Error:', err.name, err.message);
    process.exit(1);
  }

  async initialize() {
    try {
      await connectDatabase();
      await this.startServer();
    } catch (error) {
      console.error('Failed to initialize application:', error.message);
      process.exit(1);
    }
  }
}

// Create and start the server
const serverInstance = new Server();
serverInstance.initialize();

// Export for testing purposes
module.exports = serverInstance;

