const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const { format } = require('date-fns');
const { checkFeature, FEATURES } = require('../featureFlags');
const { safeFs, safePath } = require('../safePath');

exports.generateUserDataArchive = async (userData) => {
  // FEATURE FLAG: Check if data export and file uploads are enabled
  if (!checkFeature(FEATURES.DATA_EXPORT, 'generateDataExport')) {
    throw new Error('Data export feature is disabled');
  }

  if (!checkFeature(FEATURES.FILE_UPLOADS, 'generateDataExport')) {
    throw new Error('File uploads feature is disabled');
  }

  return new Promise((resolve, reject) => {
    try {
      // Create export directory if not exists - USE SAFE VERSIONS
      const exportDir = safePath.joinSafe(__dirname, '../exports');
      if (!exportDir) {
        return reject(new Error('Failed to resolve export directory path'));
      }
      
      if (!safeFs.existsSyncSafe(exportDir, { label: 'export directory' })) {
        try {
          fs.mkdirSync(exportDir, { recursive: true });
        } catch (mkdirError) {
          return reject(new Error(`Failed to create export directory: ${mkdirError.message}`));
        }
      }

      // Create file name
      const timestamp = format(new Date(), 'yyyyMMdd-HHmmss');
      const fileName = `user-data-${timestamp}.zip`;
      const filePath = safePath.joinSafe(exportDir, fileName);
      
      if (!filePath) {
        return reject(new Error('Failed to resolve export file path'));
      }

      // Create write stream
      const output = fs.createWriteStream(filePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
<<<<<<< HEAD
        console.log(`Archive created: ${archive.pointer()} bytes`);
        
        // VALIDATION: Ensure filePath and fileName are strings
        if (typeof filePath !== 'string' || typeof fileName !== 'string') {
          reject(new Error(
            `generateUserDataArchive: Invalid return values - ` +
            `filePath type: ${typeof filePath}, fileName type: ${typeof fileName}`
          ));
          return;
        }
        
        console.log(`[generateUserDataArchive] ✅ Returning filePath: ${filePath} (type: ${typeof filePath})`);
        console.log(`[generateUserDataArchive] ✅ Returning fileName: ${fileName} (type: ${typeof fileName})`);
=======
        logger.info(`Archive created: ${archive.pointer()} bytes`);
>>>>>>> 6d2bc77 (first ci/cd push)
        resolve({ filePath, fileName });
      });

      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          logger.warn('Archive warning:', err);
        } else {
          reject(err);
        }
      });

      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      // Add JSON files for each data type
      Object.entries(userData).forEach(([key, value]) => {
        const jsonData = JSON.stringify(value, null, 2);
        archive.append(jsonData, { name: `${key}.json` });
      });

      // Add a README file
      const readmeContent = `This archive contains your personal data exported from our service.\nGenerated at: ${new Date().toISOString()}`;
      archive.append(readmeContent, { name: 'README.txt' });

      // Finalize archive
      archive.finalize();
    } catch (error) {
      reject(error);
    }
  });
};
