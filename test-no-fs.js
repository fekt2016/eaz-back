// Test if ANY file operations are happening
console.log('Testing for file operations...');

// Check if fs is patched
const fs = require('fs');
const originalUnlinkSync = fs.unlinkSync.toString();

if (originalUnlinkSync.includes('trap') || originalUnlinkSync.includes('FILE_OP')) {
  console.error('❌ fs.unlinkSync is PATCHED!');
  console.error('   This means fsTrap or fileOperationLogger is still active');
  console.error('   Patch source:', originalUnlinkSync.substring(0, 200));
} else {
  console.log('✅ fs.unlinkSync is NOT patched');
}

// Check path
const path = require('path');
const originalJoin = path.join.toString();
if (originalJoin.includes('trap') || originalJoin.includes('FILE_OP')) {
  console.error('❌ path.join is PATCHED!');
} else {
  console.log('✅ path.join is NOT patched');
}

console.log('Test complete');
