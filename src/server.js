const mongoose = require('mongoose');
const app = require('./app');
const { validateEnvironment } = require('./config/env');
const connectDatabase = require('./config/database');
const logger = require('./utils/logger');

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
        (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '0.0.0.0');

      const port = parseInt(process.env.PORT || 4000, 10);

      // Validate port number
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error(
          `Invalid port number: ${process.env.PORT}. Port must be between 1 and 65535.`,
        );
      }

      this.server = app.listen(port, host, () => {
        const timestamp = new Date().toISOString();
        console.log('\n' + '='.repeat(60));
        console.log(`🚀 Server started at ${timestamp}`);
        console.log(
          `Server running in ${process.env.NODE_ENV || 'development'} mode`,
        );
        console.log(`Listening on http://${host}:${port}`);
        console.log(
          `Access locally at: http://localhost:${port} or http://127.0.0.1:${port}`,
        );
        console.log('⚠️  Background jobs are disabled (Bull/Redis removed)');
        console.log('='.repeat(60) + '\n');
        if (process.env.NODE_ENV === 'production') {
          logger.info('Production server is ready');
        }
      });

      // Handle server errors
      this.server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`Port ${port} is already in use`, {
            code: error.code,
            port,
            suggestion: `Stop the process using port ${port}, use a different port, or find process: lsof -i :${port}`,
          });
        } else if (error.code === 'EACCES') {
          logger.error(`Permission denied: Cannot bind to port ${port}`, {
            code: error.code,
            port,
            suggestion: 'Ports below 1024 require root privileges. Use a port >= 1024 or run with sudo.',
          });
        } else if (error.code === 'EADDRNOTAVAIL') {
          logger.error(`Address not available: Cannot bind to ${host}:${port}`, {
            code: error.code,
            host,
            port,
            suggestion: 'Check your HOST environment variable.',
          });
        } else {
          logger.error(`Server error: ${error.message}`, {
            code: error.code,
            error: error.message,
          });
        }
        process.exit(1);
      });

      return this.server;
    } catch (error) {
      logger.error('Failed to start server', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  async gracefulShutdown(signal) {
    logger.info(`${signal} received. Shutting down gracefully...`);

    try {
      // Close HTTP server
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(() => {
            logger.info('HTTP server closed.');
            resolve();
          });
        });
      }

      // Close MongoDB connection
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close(false);
        logger.info('MongoDB connection closed.');
      }

      logger.info('Shutdown completed.');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  }

  handleUnhandledRejection(err) {
    logger.error('UNHANDLED REJECTION! Shutting down', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });

    if (this.server) {
      this.server.close(() => {
        process.exit(1);
      });
    } else {
      process.exit(1);
    }
  }

  handleUncaughtException(err) {
    logger.error('UNCAUGHT EXCEPTION! Shutting down', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }

  async initialize() {
    try {
      // Log restart timestamp for nodemon debugging (only in development)
      if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
        console.log(`\n🔄 [${new Date().toISOString()}] Initializing server...`);
      }
      
      await connectDatabase();
      
      // Initialize cron jobs after database connection
      require('./cron/tokenCleanup');
      
      // Initialize withdrawal cleanup job (runs in all environments)
      const { startCleanupJob } = require('./jobs/withdrawalCleanupJob');
      startCleanupJob();
      
      if (process.env.NODE_ENV === 'production') {
        logger.info('Cron jobs initialized');
      } else {
        logger.info('Cron jobs initialized (including withdrawal cleanup)');
      }
      
      await this.startServer();
    } catch (error) {
      logger.error('Failed to initialize application', { error: error.message, stack: error.stack });
      process.exit(1);
    }
  }
}

// Create and start the server
const serverInstance = new Server();
serverInstance.initialize();

// Export for testing purposes
module.exports = serverInstance;

