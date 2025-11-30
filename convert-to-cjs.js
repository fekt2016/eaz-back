const fs = require('fs');
const path = require('path');

// Convert ES Modules to CommonJS
function convertToCommonJS(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  const originalContent = content;

  // 1. Convert import statements
  // import X from 'Y';
  content = content.replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"];?$/gm, (match, name, module) => {
    changed = true;
    // Remove .js extension from local imports
    if (module.startsWith('./') || module.startsWith('../')) {
      module = module.replace(/\.js$/, '').replace(/\/index$/, '');
    }
    // Handle date-fns/locale/index.js -> date-fns/locale
    if (module.includes('date-fns/locale/index.js')) {
      module = module.replace('/index.js', '');
    }
    return `const ${name} = require('${module}');`;
  });

  // import { A, B } from 'Y';
  content = content.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?$/gm, (match, names, module) => {
    changed = true;
    // Remove .js extension from local imports
    if (module.startsWith('./') || module.startsWith('../')) {
      module = module.replace(/\.js$/, '').replace(/\/index$/, '');
    }
    if (module.includes('date-fns/locale/index.js')) {
      module = module.replace('/index.js', '');
    }
    return `const {${names}} = require('${module}');`;
  });

  // import X, { A, B } from 'Y';
  content = content.replace(/^import\s+(\w+)\s*,\s*\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?$/gm, (match, defaultName, names, module) => {
    changed = true;
    if (module.startsWith('./') || module.startsWith('../')) {
      module = module.replace(/\.js$/, '').replace(/\/index$/, '');
    }
    if (module.includes('date-fns/locale/index.js')) {
      module = module.replace('/index.js', '');
    }
    return `const ${defaultName} = require('${module}');\nconst {${names}} = require('${module}');`;
  });

  // import * as X from 'Y';
  content = content.replace(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?$/gm, (match, name, module) => {
    changed = true;
    if (module.startsWith('./') || module.startsWith('../')) {
      module = module.replace(/\.js$/, '').replace(/\/index$/, '');
    }
    return `const ${name} = require('${module}');`;
  });

  // import 'Y'; (side-effect imports)
  content = content.replace(/^import\s+['"]([^'"]+)['"];?$/gm, (match, module) => {
    changed = true;
    if (module.startsWith('./') || module.startsWith('../')) {
      module = module.replace(/\.js$/, '').replace(/\/index$/, '');
    }
    return `require('${module}');`;
  });

  // 2. Convert export statements
  // export default X;
  content = content.replace(/^export\s+default\s+(.+);?$/gm, (match, value) => {
    changed = true;
    // Handle different default export patterns
    if (value.trim().startsWith('{')) {
      return `module.exports = ${value};`;
    } else if (value.includes('mongoose.model') || value.includes('model(')) {
      return `module.exports = ${value};`;
    } else {
      return `module.exports = ${value};`;
    }
  });

  // export const name = ...;
  content = content.replace(/^export\s+const\s+(\w+)\s*=/gm, (match, name) => {
    changed = true;
    return `exports.${name} =`;
  });

  // export function name(...) { ... }
  content = content.replace(/^export\s+(?:async\s+)?function\s+(\w+)/gm, (match, name) => {
    changed = true;
    return `exports.${name} = async function`;
  });

  // export { A, B };
  content = content.replace(/^export\s+\{([^}]+)\};?$/gm, (match, names) => {
    changed = true;
    const nameList = names.split(',').map(n => n.trim());
    return nameList.map(n => {
      const parts = n.split(' as ');
      const exportName = parts.length > 1 ? parts[1] : parts[0];
      const localName = parts[0];
      return `exports.${exportName} = ${localName};`;
    }).join('\n');
  });

  // export default { ... }
  content = content.replace(/^export\s+default\s+\{([^}]+)\};?$/gm, (match, props) => {
    changed = true;
    return `module.exports = {${props}};`;
  });

  // 3. Fix fileURLToPath and __dirname/__filename (ESM-specific)
  if (content.includes('fileURLToPath') || content.includes('import.meta.url')) {
    content = content.replace(/import\s+\{?\s*fileURLToPath\s*\}?\s+from\s+['"]url['"];?/g, '');
    content = content.replace(/const\s+__filename\s*=\s*fileURLToPath\(import\.meta\.url\);?/g, '');
    content = content.replace(/const\s+__dirname\s*=\s*path\.dirname\(__filename\);?/g, '');
    // Add CommonJS __dirname if not present
    if (content.includes('__dirname') && !content.includes('const __dirname')) {
      const pathImport = content.match(/const\s+path\s*=\s*require\(['"]path['"]\)/);
      if (!pathImport) {
        // Find where path is imported/required and add __dirname after
        content = content.replace(/(const\s+path\s*=\s*require\(['"]path['"]\);?)/, '$1\nconst __dirname = path.dirname(__filename);');
      }
    }
    changed = true;
  }

  // 4. Fix createRequire bridges (remove them, not needed in CommonJS)
  content = content.replace(/import\s+\{\s*createRequire\s*\}\s+from\s+['"]module['"];?\s*const\s+require\s*=\s*createRequire\(import\.meta\.url\);?\s*/g, '');
  content = content.replace(/const\s+\{\s*createRequire\s*\}\s+=\s+require\(['"]module['"]\);?\s*const\s+require\s*=\s*createRequire\(import\.meta\.url\);?\s*/g, '');

  // 5. Fix lodash imports (CommonJS compatible)
  content = content.replace(/const\s+\{\s*([^}]+)\s*\}\s+=\s+require\(['"]lodash['"]\);?/g, (match, names) => {
    // lodash in CommonJS needs default import
    return `const _ = require('lodash');\nconst {${names}} = _;`;
  });

  // 6. Fix cloudinary import
  content = content.replace(/import\s+cloudinaryPackage\s+from\s+['"]cloudinary['"];?\s*const\s+cloudinary\s*=\s*cloudinaryPackage\.v2;/g, 
    "const cloudinary = require('cloudinary').v2;");

  // 7. Fix date-fns locale imports
  content = content.replace(/from\s+['"]date-fns\/locale\/index\.js['"]/g, "from 'date-fns/locale'");
  content = content.replace(/require\(['"]date-fns\/locale\/index\.js['"]\)/g, "require('date-fns/locale')");

  if (changed && content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  }
  return false;
}

// Recursively process all .js files in src directory
function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  const converted = [];
  const skipped = [];

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      const subResults = processDirectory(filePath);
      converted.push(...subResults.converted);
      skipped.push(...subResults.skipped);
    } else if (file.endsWith('.js')) {
      try {
        if (convertToCommonJS(filePath)) {
          converted.push(filePath);
        } else {
          skipped.push(filePath);
        }
      } catch (error) {
        console.error(`Error converting ${filePath}:`, error.message);
        skipped.push(filePath);
      }
    }
  });

  return { converted, skipped };
}

// Main execution
const srcDir = path.join(__dirname, 'src');
console.log('Starting CommonJS conversion...\n');

const results = processDirectory(srcDir);

console.log(`✅ Converted ${results.converted.length} files`);
console.log(`⚙️  Skipped ${results.skipped.length} files (no changes needed or errors)\n`);

if (results.converted.length > 0) {
  console.log('Converted files:');
  results.converted.slice(0, 20).forEach(file => {
    console.log(`  - ${path.relative(__dirname, file)}`);
  });
  if (results.converted.length > 20) {
    console.log(`  ... and ${results.converted.length - 20} more`);
  }
}

