/**
 * Redis Configuration
 * 
 * NOTE: Redis and Bull queues have been removed from this project.
 * This file is kept as a placeholder to prevent import errors.
 * All Redis-related functionality has been disabled.
 * 
 * Background jobs are no longer available.
 */

/**
 * Check if Redis is available
 * @returns {boolean} Always returns false (Redis is disabled)
 */
const isRedisAvailable = () => {
  return false;
};

/**
 * Get Redis client
 * @returns {null} Always returns null (Redis is disabled)
 */
const getRedisClient = () => {
  return null;
};

/**
 * Create Redis client for Bull queues
 * @returns {Function} Returns a function that returns null
 */
const createBullRedisClient = () => {
  return () => null;
};

/**
 * Close Redis connection
 * @returns {Promise<void>} Resolves immediately
 */
const closeRedisConnection = async () => {
  // No-op: Redis is disabled
};

module.exports = {
  isRedisAvailable,
  getRedisClient,
  createBullRedisClient,
  closeRedisConnection,
};
