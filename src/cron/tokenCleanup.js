const cron = require('node-cron');
const TokenBlacklist = require('../models/user/tokenBlackListModal');
const DeviceSession = require('../models/user/deviceSessionModel');
const fs = require('fs');
const path = require('path');
const { safeFs, safePath } = require('../utils/safePath');

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

    // Log to file (with error handling) - USE SAFE VERSIONS
    try {
    const logDir = safePath.joinSafe(__dirname, '../../logs');
    if (!logDir) {
      console.warn('[TokenCleanup] ⚠️  Failed to resolve log directory path');
      // Continue without logging to file
    } else {
      if (!safeFs.existsSyncSafe(logDir, { label: 'cron log directory' })) {
        try {
          fs.mkdirSync(logDir, { recursive: true });
        } catch (mkdirError) {
          console.warn('[TokenCleanup] ⚠️  Failed to create log directory:', mkdirError.message);
          // Continue without logging to file
        }
      }

      const logFile = safePath.joinSafe(logDir, 'cron.log');
      if (!logFile) {
        console.warn('[TokenCleanup] ⚠️  Failed to resolve log file path');
        // Continue without logging to file
      } else {
        // Use safe write (but appendFileSync doesn't have a safe version, so use regular with try/catch)
        try {
          fs.appendFileSync(logFile, logMessage, 'utf8');
        } catch (writeError) {
          console.warn('[TokenCleanup] ⚠️  Failed to write to log file:', writeError.message);
        }
      }
    }
    } catch (fileError) {
      // Don't fail the cleanup if file logging fails
      console.warn('[TokenCleanup] ⚠️ Failed to write to log file:', fileError.message);
    }

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

    // Log error to file (with error handling) - USE SAFE VERSIONS
    try {
    const logDir = safePath.joinSafe(__dirname, '../../logs');
    if (!logDir) {
      console.warn('[TokenCleanup] ⚠️  Failed to resolve log directory path for error logging');
      return; // Can't log error to file
    }
    
    if (!safeFs.existsSyncSafe(logDir, { label: 'cron log directory' })) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch (mkdirError) {
        console.warn('[TokenCleanup] ⚠️  Failed to create log directory for error logging:', mkdirError.message);
        return; // Can't log error to file
      }
    }

    const logFile = safePath.joinSafe(logDir, 'cron.log');
    if (!logFile) {
      console.warn('[TokenCleanup] ⚠️  Failed to resolve log file path for error logging');
        // Continue without logging to file
      } else {
    fs.appendFileSync(logFile, errorMessage, 'utf8');
      }
    } catch (fileError) {
      // Don't fail the cleanup if file logging fails
      console.warn('[TokenCleanup] ⚠️ Failed to write error to log file:', fileError.message);
    }

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

