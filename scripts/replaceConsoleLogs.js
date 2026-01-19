/**
 * Script to replace console.log/error/warn with Winston logger
 * 
 * Usage: node scripts/replaceConsoleLogs.js [--dry-run] [--file path/to/file.js]
 * 
 * --dry-run: Show what would be changed without making changes
 * --file: Process only a specific file
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DRY_RUN = process.argv.includes('--dry-run');
const SPECIFIC_FILE = process.argv.find(arg => arg.startsWith('--file='))?.split('=')[1];
const SRC_DIR = path.join(__dirname, '../src');

// Patterns to match console statements
const CONSOLE_PATTERNS = [
  {
    pattern: /console\.log\(/g,
    replacement: 'logger.info(',
    name: 'console.log'
  },
  {
    pattern: /console\.error\(/g,
    replacement: 'logger.error(',
    name: 'console.error'
  },
  {
    pattern: /console\.warn\(/g,
    replacement: 'logger.warn(',
    name: 'console.warn'
  },
  {
    pattern: /console\.info\(/g,
    replacement: 'logger.info(',
    name: 'console.info'
  },
  {
    pattern: /console\.debug\(/g,
    replacement: 'logger.debug(',
    name: 'console.debug'
  }
];

// Files to exclude
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.test\.js$/,
  /\.spec\.js$/,
  /logger\.js$/, // Don't modify logger itself
  /replaceConsoleLogs\.js$/, // Don't modify this script
  // Note: env.js may intentionally use console.log during bootstrap
  // but we'll still process it for consistency - review manually if needed
];

// Get all JavaScript files recursively
function getAllJSFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      getAllJSFiles(filePath, fileList);
    } else if (file.endsWith('.js') && !EXCLUDE_PATTERNS.some(pattern => pattern.test(filePath))) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

// Check if file already imports logger
function hasLoggerImport(content) {
  return /require\(['"]\.\.\/utils\/logger['"]\)/.test(content) ||
         /require\(['"]\.\.\/\.\.\/utils\/logger['"]\)/.test(content) ||
         /require\(['"]\.\.\/\.\.\/\.\.\/utils\/logger['"]\)/.test(content) ||
         /require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/utils\/logger['"]\)/.test(content) ||
         /const logger = require/.test(content);
}

// Calculate relative path from file to logger
function getLoggerPath(filePath) {
  const relativePath = path.relative(path.dirname(filePath), path.join(SRC_DIR, 'utils', 'logger'));
  const normalized = relativePath.replace(/\\/g, '/'); // Normalize path separators
  
  if (!normalized.startsWith('.')) {
    return `./${normalized}`;
  }
  return normalized;
}

// Add logger import if needed
function ensureLoggerImport(content, filePath) {
  if (hasLoggerImport(content)) {
    return content;
  }

  const loggerPath = getLoggerPath(filePath);
  const loggerRequire = `const logger = require('${loggerPath}');`;

  // Find the best place to insert logger import
  // Try after other requires or at the top
  const requirePattern = /^(const|let|var)\s+\w+\s*=\s*require\(/m;
  const match = content.match(requirePattern);

  if (match) {
    // Find the last require statement
    const lines = content.split('\n');
    let lastRequireIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
      if (/^(const|let|var)\s+\w+\s*=\s*require\(/.test(lines[i])) {
        lastRequireIndex = i;
      }
    }

    if (lastRequireIndex >= 0) {
      // Insert after the last require
      lines.splice(lastRequireIndex + 1, 0, loggerRequire);
      return lines.join('\n');
    }
  }

  // Fallback: add at the top after any comments
  const lines = content.split('\n');
  let insertIndex = 0;
  
  // Skip comment blocks at the top
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('//') || lines[i].trim().startsWith('/*')) {
      insertIndex = i + 1;
    } else if (lines[i].trim() === '' || lines[i].trim().startsWith('*')) {
      insertIndex = i + 1;
    } else {
      break;
    }
  }

  lines.splice(insertIndex, 0, loggerRequire);
  return lines.join('\n');
}

// Process a single file
function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let newContent = content;
    let changes = [];

    // Check for console statements
    for (const { pattern, replacement, name } of CONSOLE_PATTERNS) {
      const matches = content.match(pattern);
      if (matches) {
        changes.push(`${matches.length} ${name} statement(s)`);
        if (!DRY_RUN) {
          newContent = newContent.replace(pattern, replacement);
        }
      }
    }

    if (changes.length === 0) {
      return { file: filePath, changes: [], needsLogger: false };
    }

    // Check if logger import is needed
    const needsLogger = changes.length > 0 && !hasLoggerImport(newContent);
    
    if (needsLogger && !DRY_RUN) {
      newContent = ensureLoggerImport(newContent, filePath);
    }

    return {
      file: filePath,
      changes,
      needsLogger: needsLogger && !hasLoggerImport(content),
      content: newContent,
      originalContent: content
    };
  } catch (error) {
    return {
      file: filePath,
      error: error.message
    };
  }
}

// Main execution
function main() {
  console.log('🔍 Searching for console statements...\n');

  const files = SPECIFIC_FILE 
    ? [path.resolve(SPECIFIC_FILE)]
    : getAllJSFiles(SRC_DIR);

  const results = [];
  let totalReplacements = 0;

  for (const file of files) {
    const result = processFile(file);
    if (result.changes && result.changes.length > 0) {
      results.push(result);
      const count = result.changes.reduce((sum, change) => {
        const match = change.match(/(\d+)/);
        return sum + (match ? parseInt(match[1]) : 0);
      }, 0);
      totalReplacements += count;
    } else if (result.error) {
      console.error(`❌ Error processing ${file}: ${result.error}`);
    }
  }

  // Display results
  console.log(`\n📊 Results:\n`);
  console.log(`Files with console statements: ${results.length}`);
  console.log(`Total replacements needed: ${totalReplacements}`);
  
  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN MODE - No files were modified\n');
  }

  // Show details
  if (results.length > 0) {
    console.log('\n📝 Files to modify:\n');
    results.forEach(({ file, changes, needsLogger }) => {
      const relativePath = path.relative(process.cwd(), file);
      console.log(`  ${relativePath}`);
      changes.forEach(change => console.log(`    - ${change}`));
      if (needsLogger) {
        console.log(`    - ⚠️  Needs logger import`);
      }
    });
  }

  // Write changes if not dry run
  if (!DRY_RUN && results.length > 0) {
    console.log('\n💾 Writing changes...\n');
    let successCount = 0;
    let errorCount = 0;

    results.forEach(result => {
      try {
        if (result.content) {
          fs.writeFileSync(result.file, result.content, 'utf8');
          console.log(`  ✅ ${path.relative(process.cwd(), result.file)}`);
          successCount++;
        }
      } catch (error) {
        console.error(`  ❌ ${path.relative(process.cwd(), result.file)}: ${error.message}`);
        errorCount++;
      }
    });

    console.log(`\n✅ Successfully modified: ${successCount} files`);
    if (errorCount > 0) {
      console.log(`❌ Errors: ${errorCount} files`);
    }
  }

  if (DRY_RUN && results.length > 0) {
    console.log('\n💡 To apply changes, run without --dry-run flag:');
    console.log('   node scripts/replaceConsoleLogs.js\n');
  }
}

// Run the script
main();
