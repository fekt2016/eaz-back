const Queue = require('bull');
const Redis = require('ioredis');
const { processDataExportJob } = require('../workers/dataExportJob');

// Initialize queue
const dataExportQueue = new Queue('data exports', {
  createClient: () => new Redis(process.env.REDIS_URL),
  limiter: {
    max: 5, // Max jobs per period
    duration: 10000, // 10 seconds
  },
});

// Export the queue for adding jobs
module.exports = dataExportQueue;;

// Export initialization function that takes cloudinary
exports.initializeProcessor = (cloudinary) => {
  // Process jobs with concurrency control
  dataExportQueue.process(3, async (job) => {
    return processDataExportJob(job, cloudinary);
  });

  // Handle completed/failed jobs
  dataExportQueue.on('completed', (job) => {
    console.log(`Export job ${job.id} completed for user ${job.data.userId}`);
  });

  dataExportQueue.on('failed', (job, err) => {
    console.error(`Export job ${job.id} failed:`, err);
  });
};
