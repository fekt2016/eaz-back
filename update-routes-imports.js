const fs = require('fs');
const path = require('path');

function updateRouteImports(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Fix controller imports in routes
  const patterns = [
    // Fix relative paths from routes to controllers
    {
      from: /require\(['"]\.\.\/Controllers\/([^'"]+)['"]\)/g,
      to: (match, controller) => {
        // Determine controller location
        if (controller.includes('auth') && !controller.includes('Admin') && !controller.includes('Seller')) {
          return `require('../../controllers/buyer/${controller}')`;
        } else if (controller.includes('authAdmin') || (controller.includes('admin') && !controller.includes('seller'))) {
          return `require('../../controllers/admin/${controller.replace('authAdmin', 'auth').replace('auth', 'authAdmin')}')`;
        } else if (controller.includes('authSeller') || controller.includes('seller')) {
          return `require('../../controllers/seller/${controller.replace('authSeller', 'auth')}')`;
        } else {
          return `require('../../controllers/shared/${controller}')`;
        }
      }
    },
    {
      from: /require\(['"]\.\.\/buyer\/([^'"]+)['"]\)/g,
      to: (match, controller) => `require('../../controllers/buyer/${controller}')`
    },
    {
      from: /require\(['"]\.\.\/shared\/([^'"]+)['"]\)/g,
      to: (match, controller) => `require('../../controllers/shared/${controller}')`
    },
    {
      from: /require\(['"]\.\.\/seller\/([^'"]+)['"]\)/g,
      to: (match, controller) => `require('../../controllers/seller/${controller}')`
    },
    {
      from: /require\(['"]\.\.\/admin\/([^'"]+)['"]\)/g,
      to: (match, controller) => `require('../../controllers/admin/${controller}')`
    }
  ];

  patterns.forEach(({ from, to }) => {
    const newContent = content.replace(from, to);
    if (newContent !== content) {
      content = newContent;
      changed = true;
    }
  });

  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated routes: ${filePath}`);
  }
}

function walkDir(dir) {
  const files = fs.readDirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath);
    } else if (file.endsWith('.js')) {
      updateRouteImports(filePath);
    }
  });
}

walkDir(path.join(__dirname, 'src/routes'));
console.log('Route imports updated!');

