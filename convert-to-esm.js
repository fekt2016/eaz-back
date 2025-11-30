// Script to convert CommonJS to ES Modules
// Run with: node convert-to-esm.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const convertFile = (filePath) => {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;
    const originalContent = content;

    // Skip if already converted (has import statement)
    if (content.includes('import ') && !content.includes('require(')) {
      return false;
    }

    // Convert require() to import
    // Pattern: const name = require('path');
    content = content.replace(
      /const\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?/g,
      (match, name, importPath) => {
        changed = true;
        // Handle relative paths - add .js extension
        if (importPath.startsWith('.')) {
          // Remove .js if already present to avoid duplication
          const cleanPath = importPath.replace(/\.js$/, '');
          return `import ${name} from '${cleanPath}.js';`;
        }
        // External packages - no .js extension
        return `import ${name} from '${importPath}';`;
      }
    );

    // Pattern: const { name1, name2 } = require('path');
    content = content.replace(
      /const\s+\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)\s*;?/g,
      (match, names, importPath) => {
        changed = true;
        const cleanNames = names.trim();
        if (importPath.startsWith('.')) {
          const cleanPath = importPath.replace(/\.js$/, '');
          return `import { ${cleanNames} } from '${cleanPath}.js';`;
        }
        return `import { ${cleanNames} } from '${importPath}';`;
      }
    );

    // Convert module.exports = ...
    content = content.replace(
      /module\.exports\s*=\s*([^;]+);?/g,
      (match, exportValue) => {
        changed = true;
        // Check if it's a function or object
        const trimmed = exportValue.trim();
        if (trimmed.startsWith('(') || trimmed.match(/^(async\s+)?\w+\s*=>/)) {
          // Function
          return `export default ${trimmed};`;
        }
        return `export default ${trimmed};`;
      }
    );

    // Convert exports.name = ...
    content = content.replace(
      /exports\.(\w+)\s*=\s*([^;]+);?/g,
      (match, name, value) => {
        changed = true;
        return `export const ${name} = ${value};`;
      }
    );

    if (changed && content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error converting ${filePath}:`, error.message);
    return false;
  }
};

const convertDirectory = (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let converted = 0;

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      converted += convertDirectory(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      if (convertFile(fullPath)) {
        converted++;
        console.log(`✅ Converted: ${fullPath}`);
      }
    }
  }

  return converted;
};

// Start conversion
const srcDir = path.join(__dirname, 'src');
console.log(`Converting files in ${srcDir}...\n`);

const totalConverted = convertDirectory(srcDir);
console.log(`\n✅ Conversion complete! ${totalConverted} files converted.`);

