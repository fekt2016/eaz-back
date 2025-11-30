const dotenv = require('dotenv');
const path = require('path');




// Load environment variables (.env is in backend directory)
// Try .env first, fallback to config.env for backward compatibility
// __dirname is backend/src/config, so go up two levels to backend/
const envPath = path.join(__dirname, '../../.env');
const configEnvPath = path.join(__dirname, '../../config.env');
const fs = require('fs');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log(`✅ Loaded environment from: ${envPath}`);
} else if (fs.existsSync(configEnvPath)) {
  dotenv.config({ path: configEnvPath });
  console.log(`✅ Loaded environment from: ${configEnvPath}`);
} else {
  // Try default .env location
  dotenv.config({ path: envPath });
  console.log(`⚠️  Attempting to load from: ${envPath} (file may not exist)`);
}

// Validate required environment variables
const requiredEnvVars = [
  'MONGO_URL',
  'DATABASE_PASSWORD',
  'JWT_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
  'SENDGRID_API_KEY', // Required for email service
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

exports.validateEnvironment = validateEnvironment;

