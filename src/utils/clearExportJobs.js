/**
 * CLEAR EXPORT JOBS
 *
 * NOTE: Bull queues have been removed from this project.
 * This utility is kept as a no-op to prevent import errors.
 * Background jobs are no longer available.
 */

/**
 * Clear all pending export jobs from the queue
 * No-op: Queues are disabled
 */
const clearExportJobs = async () => {
  // No-op: Background jobs are disabled (Bull/Redis removed)
  console.log('[clearExportJobs] Background jobs are disabled (Bull/Redis removed)');
};

module.exports = { clearExportJobs };
