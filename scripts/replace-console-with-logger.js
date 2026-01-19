#!/usr/bin/env node
/**
 * Script to replace console.log/error/warn/debug with logger calls
 * Usage: node scripts/replace-console-with-logger.js
 */

const fs = require('fs');
const path = require('path');

const BACKEND_SRC = path.join(__dirname, '../src');
const EXCLUDED_FILES = [
  'utils/logger.js', // Don't modify logger itself
  'app.js.backup', // Backup files
];

/**
 * Get all JavaScript files recursively
 */
function getAllJSFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      getAllJSFiles(filePath, fileList);
    } else if (file.endsWith('.js')) {
      const relativePath = path.relative(BACKEND_SRC, filePath).replace(/\\/g, '/');
      if (!EXCLUDED_FILES.some((excluded) => relativePath.includes(excluded))) {
        fileList.push(filePath);
      }
    }
  });

  return fileList;
}

/**
 * Calculate relative path from file to logger
 */
function getLoggerPath(fromFile, toLogger = 'utils/logger') {
  const fromDir = path.dirname(fromFile);
  const fromRelative = path.relative(BACKEND_SRC, fromDir);
  const toRelative = toLogger;
  
  // If same directory level, use './'
  if (fromRelative === path.dirname(toRelative)) {
    return './logger';
  }
  
  // Calculate relative path
  const fromParts = fromRelative.split(path.sep).filter(Boolean);
  const toParts = toRelative.split('/').filter(Boolean);
  
  let commonLength = 0;
  for (let i = 0; i < Math.min(fromParts.length, toParts.length); i++) {
    if (fromParts[i] === toParts[i]) {
      commonLength++;
    } else {
      break;
    }
  }
  
  const upLevels = fromParts.length - commonLength;
  const upPath = upLevels > 0 ? '../'.repeat(upLevels) : './';
  const downPath = toParts.slice(commonLength).join('/');
  
  return upPath + downPath;
}

/**
 * Replace console statements in a file
 */
function replaceConsoleInFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const loggerPath = getLoggerPath(filePath);
  
  // Check if logger is already imported
  const hasLoggerImport = /require\(['"]\.\.?\/.+logger['"]\)/.test(content) || 
                          /from ['"]\.\.?\/.+logger['"]/.test(content);
  
  // Skip if already has logger import and no console statements
  if (hasLoggerImport && !/console\.(log|error|warn|debug)/.test(content)) {
    return { replaced: 0, skipped: true };
  }
  
  let newContent = content;
  let replaced = 0;
  
  // Add logger import if not present and file has console statements
  if (!hasLoggerImport && /console\.(log|error|warn|debug)/.test(content)) {
    // Find the last require statement or import
    const requireMatch = content.match(/(const|let|var)\s+\w+\s*=\s*require\(['"][^'"]+['"]\);/g);
    if (requireMatch) {
      const lastRequire = requireMatch[requireMatch.length - 1];
      const lastRequireIndex = content.lastIndexOf(lastRequire);
      const insertIndex = lastRequireIndex + lastRequire.length;
      newContent = content.slice(0, insertIndex) + 
                   `\nconst logger = require('${loggerPath}');` +
                   content.slice(insertIndex);
    } else {
      // Insert at the beginning after any shebang
      const shebangMatch = content.match(/^#!\/usr\/bin\/env node\n/);
      if (shebangMatch) {
        const insertIndex = shebangMatch[0].length;
        newContent = content.slice(0, insertIndex) + 
                     `const logger = require('${loggerPath}');\n` +
                     content.slice(insertIndex);
      } else {
        newContent = `const logger = require('${loggerPath}');\n` + content;
      }
    }
  }
  
  // Replace console.log with logger.info (for production safety, only log in dev)
  // But since we're removing all console, we'll use logger.info for all
  newContent = newContent.replace(/console\.log\((.*?)\);?/g, (match, args) => {
    replaced++;
    // Simple replacement - logger.info with same args
    return `logger.info(${args});`;
  });
  
  // Replace console.error with logger.error
  newContent = newContent.replace(/console\.error\((.*?)\);?/g, (match, args) => {
    replaced++;
    // Try to extract meaningful error info
    return `logger.error(${args});`;
  });
  
  // Replace console.warn with logger.warn
  newContent = newContent.replace(/console\.warn\((.*?)\);?/g, (match, args) => {
    replaced++;
    return `logger.warn(${args});`;
  });
  
  // Replace console.debug with logger.debug
  newContent = newContent.replace(/console\.debug\((.*?)\);?/g, (match, args) => {
    replaced++;
    return `logger.debug(${args});`;
  });
  
  if (replaced > 0) {
    fs.writeFileSync(filePath, newContent, 'utf8');
  }
  
  return { replaced, skipped: false };
}

// Main execution
const files = getAllJSFiles(BACKEND_SRC);
console.log(`Found ${files.length} JavaScript files to process...`);

let totalReplaced = 0;
let filesModified = 0;

files.forEach((file) => {
  try {
    const result = replaceConsoleInFile(file);
    if (!result.skipped && result.replaced > 0) {
      totalReplaced += result.replaced;
      filesModified++;
      console.log(`✅ ${path.relative(BACKEND_SRC, file)}: ${result.replaced} replacements`);
    }
  } catch (error) {
    console.error(`❌ Error processing ${file}:`, error.message);
  }
});

console.log(`\n📊 Summary:`);
console.log(`   Files processed: ${files.length}`);
console.log(`   Files modified: ${filesModified}`);
console.log(`   Total replacements: ${totalReplaced}`);
