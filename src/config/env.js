const dotenv = require('dotenv');
const path = require('path');

// NOTE: This file runs BEFORE logger is available during startup
// Keep console statements here - they're necessary for initial setup

// Load environment variables (.env is in backend directory)
// Try .env first, fallback to config.env for backward compatibility
// __dirname is backend/src/config, so go up two levels to backend/
const envPath = path.join(__dirname, '../../.env');
const configEnvPath = path.join(__dirname, '../../config.env');
const fs = require('fs');
const logger = require('../utils/logger');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  // console.log only used during startup - logger not available yet
  if (process.env.NODE_ENV !== 'production') {
    logger.info(`✅ Loaded environment from: ${envPath}`);
  }
} else if (fs.existsSync(configEnvPath)) {
  dotenv.config({ path: configEnvPath });
  // console.log only used during startup - logger not available yet
  if (process.env.NODE_ENV !== 'production') {
    logger.info(`✅ Loaded environment from: ${configEnvPath}`);
  }
} else {
  // Try default .env location
  dotenv.config({ path: envPath });
  // console.log only used during startup - logger not available yet
  if (process.env.NODE_ENV !== 'production') {
    logger.info(`⚠️  Attempting to load from: ${envPath} (file may not exist)`);
  }
}

// Validate required environment variables
const requiredEnvVars = [
  'MONGO_URL',
  'DATABASE_PASSWORD',
  'JWT_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'RESEND_API_KEY', // Required for email service
  'EMAIL_FROM', // Default sender email
];

// Environment variables required in production only
const productionRequiredEnvVars = [
  'PAYSTACK_SECRET_KEY', // Required for payment processing
  'FRONTEND_URL', // Required for CORS and email links
];

// Environment variables that should be validated (warn if missing)
const recommendedEnvVars = [
  'PORT', // Defaults to 4000, but should be explicit in production
  'HOST', // Defaults based on NODE_ENV, but should be explicit in production
];

const validateEnvironment = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

  // Check required environment variables (all environments)
  const missingVars = requiredEnvVars.filter(
    (envVar) => !process.env[envVar],
  );

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}`,
    );
  }

  // Check production-only required variables
  if (isProduction) {
    const missingProductionVars = productionRequiredEnvVars.filter(
      (envVar) => !process.env[envVar],
    );

    if (missingProductionVars.length > 0) {
      throw new Error(
        `Missing required environment variables for production: ${missingProductionVars.join(', ')}`,
      );
    }
  } else {
    // In development, warn about missing production vars
    const missingProductionVars = productionRequiredEnvVars.filter(
      (envVar) => !process.env[envVar],
    );

    if (missingProductionVars.length > 0) {
      logger.warn(
        `⚠️  Missing recommended environment variables (required in production): ${missingProductionVars.join(', ')}`,
      );
    }
  }

  // Validate recommended variables
  const missingRecommendedVars = recommendedEnvVars.filter(
    (envVar) => !process.env[envVar],
  );

  if (missingRecommendedVars.length > 0 && isProduction) {
    logger.warn(
      `⚠️  Recommended environment variables not set (using defaults): ${missingRecommendedVars.join(', ')}`,
    );
  }

  // Validate NODE_ENV
  if (!process.env.NODE_ENV) {
    logger.warn('⚠️  NODE_ENV not set. Defaulting to development mode.');
  } else if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'production') {
    logger.warn(
      `⚠️  NODE_ENV is set to "${process.env.NODE_ENV}". Expected "development" or "production".`,
    );
  }

  // Validate PAYSTACK_SECRET_KEY format (if set)
  if (process.env.PAYSTACK_SECRET_KEY) {
    const paystackKey = process.env.PAYSTACK_SECRET_KEY.trim();
    if (paystackKey.length < 20) {
      logger.warn(
        '⚠️  PAYSTACK_SECRET_KEY appears to be invalid (too short). Expected a valid Paystack secret key.',
      );
    }
    if (!paystackKey.startsWith('sk_')) {
      logger.warn(
        '⚠️  PAYSTACK_SECRET_KEY should start with "sk_" for live keys or "sk_test_" for test keys.',
      );
    }
  }

  // Validate FRONTEND_URL format (if set)
  if (process.env.FRONTEND_URL) {
    const frontendUrl = process.env.FRONTEND_URL.trim();
    try {
      const url = new URL(frontendUrl);
      if (isProduction && url.protocol !== 'https:') {
        logger.warn(
          `⚠️  FRONTEND_URL should use HTTPS in production. Current: ${frontendUrl}`,
        );
      }
    } catch (error) {
      logger.warn(
        `⚠️  FRONTEND_URL appears to be invalid: ${frontendUrl}. Expected a valid URL.`,
      );
    }
  }

  // Validate PORT (if set)
  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error(
        `Invalid PORT value: ${process.env.PORT}. Port must be between 1 and 65535.`,
      );
    }
  }

  // Log successful validation
  if (isProduction) {
    logger.info('✅ Environment variables validated successfully for production');
  } else {
    logger.info('✅ Environment variables validated successfully for development');
  }
};

exports.validateEnvironment = validateEnvironment;

