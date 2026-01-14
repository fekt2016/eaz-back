/**
 * FEATURE FLAGS
 *
 * Centralized feature flag management for safely disabling
 * problematic features without breaking core functionality.
 *
 * Usage:
 *   const { checkFeature, FEATURES } = require('./utils/featureFlags');
 *   if (!checkFeature(FEATURES.DATA_EXPORT)) {
 *     return res.status(503).json({ status: 'disabled', message: 'Feature temporarily unavailable' });
 *   }
 */

/**
 * Check if a feature is enabled
 * @param {string} featureName - Name of the feature flag
 * @returns {boolean} - True if feature is enabled
 */
const isFeatureEnabled = (featureName) => {
  const envKey = `ENABLE_${featureName}`;
  const value = process.env[envKey];

  // Default to false if not set (fail-safe)
  if (value === undefined || value === null) {
    return false;
  }

  // Accept 'true', '1', 'yes' as enabled
  const normalized = String(value).toLowerCase().trim();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

/**
 * Get feature flag status with logging
 * @param {string} featureName - Name of the feature flag
 * @param {string} context - Context for logging (optional)
 * @returns {boolean} - True if feature is enabled
 */
const checkFeature = (featureName, context = '') => {
  const enabled = isFeatureEnabled(featureName);
  const envKey = `ENABLE_${featureName}`;

  if (!enabled) {
    const logContext = context ? `[${context}] ` : '';
    console.warn(
      `⚠️  ${logContext}Feature "${featureName}" is disabled (${envKey}=${process.env[envKey] || 'not set'})`
    );
  }

  return enabled;
};

// Feature flag names (constants)
const FEATURES = {
  DATA_EXPORT: 'DATA_EXPORT',
  FILE_UPLOADS: 'FILE_UPLOADS',
  BULL_QUEUES: 'BULL_QUEUES',
};

module.exports = {
  isFeatureEnabled,
  checkFeature,
  FEATURES,
};
