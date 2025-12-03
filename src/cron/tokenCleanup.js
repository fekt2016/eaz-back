const cron = require('node-cron');
const TokenBlacklist = require('../models/user/tokenBlackListModal');
const DeviceSession = require('../models/user/deviceSessionModel');
const fs = require('fs');
const path = require('path');

/**
 * 90-Day Token Cleanup Cron Job
 * Runs daily at 02:00 AM
 * Removes blacklisted tokens older than 90 days
 */
const tokenCleanup = async () => {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days ago

    console.log(`[TokenCleanup] Starting cleanup at ${now.toISOString()}`);
    console.log(`[TokenCleanup] Removing tokens older than ${cutoff.toISOString()}`);

    // Delete blacklisted tokens older than 90 days
    // Note: MongoDB TTL index should handle this automatically, but we'll do a manual cleanup as well
    const result = await TokenBlacklist.deleteMany({
      createdAt: { $lt: cutoff },
    });

    // Also clean up expired device sessions
    const expiredSessions = await DeviceSession.updateMany(
      {
        expiresAt: { $lt: now },
        isActive: true,
      },
      {
        isActive: false,
      },
    );

    // Clean up inactive sessions (30+ days inactive)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const inactiveSessions = await DeviceSession.updateMany(
      {
        lastActivity: { $lt: thirtyDaysAgo },
        isActive: true,
      },
      {
        isActive: false,
      },
    );

    const logMessage = `🧹 TokenCleanup: Removed ${result.deletedCount} expired tokens, deactivated ${expiredSessions.modifiedCount} expired sessions, and ${inactiveSessions.modifiedCount} inactive sessions at ${now.toISOString()}\n`;

    console.log(logMessage);

    // Log to file
    const logDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, 'cron.log');
    fs.appendFileSync(logFile, logMessage, 'utf8');

    return {
      tokensRemoved: result.deletedCount,
      expiredSessionsDeactivated: expiredSessions.modifiedCount,
      inactiveSessionsDeactivated: inactiveSessions.modifiedCount,
      timestamp: now.toISOString(),
    };
  } catch (error) {
    const errorMessage = `[TokenCleanup] Error: ${error.message} at ${new Date().toISOString()}\n`;
    console.error(errorMessage);
    console.error(error);

    // Log error to file
    const logDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, 'cron.log');
    fs.appendFileSync(logFile, errorMessage, 'utf8');

    throw error;
  }
};

// Schedule cron job to run daily at 02:00 AM
// Cron format: minute hour day month day-of-week
// '0 2 * * *' = At 02:00 AM every day
const schedule = '0 2 * * *';

// Only schedule cron job in production
if (process.env.NODE_ENV === 'production') {
  console.log(`[TokenCleanup] Scheduling cron job: ${schedule} (Daily at 02:00 AM)`);
  
  cron.schedule(schedule, async () => {
    await tokenCleanup();
  }, {
    scheduled: true,
    timezone: 'UTC', // Adjust timezone as needed
  });
} else {
  console.log(`[TokenCleanup] ⚠️  Cron job DISABLED in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`[TokenCleanup] To enable, set NODE_ENV=production`);
}

// Run cleanup immediately on startup (optional, for testing)
// Uncomment the line below if you want to run cleanup on server start
// tokenCleanup().catch(console.error);

module.exports = { tokenCleanup };

