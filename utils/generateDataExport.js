const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

exports.generateUserDataArchive = async (userData) => {
  return new Promise((resolve, reject) => {
    try {
      // Create export directory if not exists
      const exportDir = path.join(__dirname, '../exports');
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      // Create file name
      const timestamp = format(new Date(), 'yyyyMMdd-HHmmss');
      const fileName = `user-data-${timestamp}.zip`;
      const filePath = path.join(exportDir, fileName);

      // Create write stream
      const output = fs.createWriteStream(filePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        console.log(`Archive created: ${archive.pointer()} bytes`);
        resolve({ filePath, fileName });
      });

      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          console.warn('Archive warning:', err);
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
