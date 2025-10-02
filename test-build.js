const fs = require('fs');
const path = require('path');

// Check if dist directory exists
if (!fs.existsSync(path.join(__dirname, 'dist'))) {
  console.error('❌ dist directory does not exist');
  process.exit(1);
}

// Check if index.js exists
if (!fs.existsSync(path.join(__dirname, 'dist', 'index.js'))) {
  console.error('❌ dist/index.js does not exist');
  process.exit(1);
}

console.log('✅ Build verification successful: dist/index.js exists');