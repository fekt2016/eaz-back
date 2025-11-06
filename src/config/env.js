const dotenv = require('dotenv');
const path = require('path');

// Load environment variables (config.env is at project root)
dotenv.config({ path: path.join(__dirname, '../../config.env') });

// Validate required environment variables
const requiredEnvVars = [
  'MONGO_URL',
  'DATABASE_PASSWORD',
  'JWT_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

const validateEnvironment = () => {
  const missingVars = requiredEnvVars.filter(
    (envVar) => !process.env[envVar],
  );

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}`,
    );
  }
};

module.exports = {
  validateEnvironment,
};

