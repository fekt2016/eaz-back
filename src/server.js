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

      const port = parseInt(process.env.PORT || 4000, 10);

      // Validate port number
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(
          `Invalid port numbers: ${process.env.PORT}. Port must be between 1 and 65535.`,
        );
      }

      this.server = app.listen(port, host, () => {
        console.log(
          `Server running in ${process.env.NODE_ENV || 'development'} mode`,
        );
        console.log(`Listening on http://${host}:${port}`);
        console.log(
          `Access locally at: http://localhost:${port} or http://127.0.0.1:${port}`,
        );

        if (process.env.NODE_ENV === 'production') {
          console.log('Production server is ready');
        }
      });

      // Handle server errors
      this.server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`\n❌ Port ${port} is already in use`);
          console.error(
            `\nTo fix this, you can:\n  1. Stop the process using port ${port}\n  2. Use a different port by setting PORT environment variable\n  3. Find the process: lsof -i :${port}`,
          );
          console.error(
            `\nSuggested alternative ports: ${port + 1}, ${port + 2}, 3000, 5000`,
          );
        } else if (error.code === 'EACCES') {
          console.error(
            `\n❌ Permission denied: Cannot bind to port ${port}`,
          );
          console.error(
            `Ports below 1024 require root privileges. Use a port >= 1024 or run with sudo.`,
          );
        } else if (error.code === 'EADDRNOTAVAIL') {
          console.error(
            `\n❌ Address not available: Cannot bind to ${host}:${port}`,
          );
          console.error(`Check your HOST environment variable.`);
        } else {
          console.error(`\n❌ Server error: ${error.message}`);
          console.error(`Error code: ${error.code}`);
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
      
      // Initialize cron jobs after database connection
      require('./cron/tokenCleanup');
      
      // Initialize withdrawal cleanup job (runs in all environments)
      const { startCleanupJob } = require('./jobs/withdrawalCleanupJob');
      startCleanupJob();
      
      if (process.env.NODE_ENV === 'production') {
        console.log('✅ Cron jobs initialized');
      } else {
        console.log('✅ Cron jobs initialized (including withdrawal cleanup)');
      }
      
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

