// 🔍 DIAGNOSTIC SCRIPT - Find the exact source of ERR_INVALID_ARG_TYPE

console.log('🔍 Starting diagnostic...\n');

// Test 1: Check if fs is patched
console.log('Test 1: Checking if fs is patched...');
const fs = require('fs');
const fsCode = fs.unlinkSync.toString();
if (fsCode.includes('trap') || fsCode.includes('FILE_OP')) {
  console.error('❌ fs.unlinkSync IS PATCHED!');
  console.error('   This means fsTrap or fileOperationLogger is active');
} else {
  console.log('✅ fs.unlinkSync is NOT patched');
}

// Test 2: Check if path is patched
console.log('\nTest 2: Checking if path is patched...');
const path = require('path');
const pathCode = path.join.toString();
if (pathCode.includes('trap') || pathCode.includes('FILE_OP')) {
  console.error('❌ path.join IS PATCHED!');
} else {
  console.log('✅ path.join is NOT patched');
}

// Test 3: Try to trigger the error
console.log('\nTest 3: Testing file operations...');
try {
  // This should work fine
  const testPath = __dirname + '/test.txt';
  console.log('   Testing with string path:', testPath);
  // Don't actually create file, just test path.join
  const joined = path.join(__dirname, 'test.txt');
  console.log('   ✅ path.join works:', typeof joined);
  
  // Test with object (this should fail)
  console.log('\n   Testing with object (should fail)...');
  try {
    path.join({ path: 'test' });
    console.error('   ❌ path.join accepted object! This is wrong!');
  } catch (e) {
    if (e.message.includes('ERR_INVALID_ARG_TYPE')) {
      console.error('   ❌ ERR_INVALID_ARG_TYPE triggered!');
      console.error('   Error:', e.message);
    } else {
      console.log('   ✅ path.join correctly rejected object');
    }
  }
} catch (e) {
  console.error('   ❌ Error during test:', e.message);
  if (e.stack) console.error(e.stack);
}

// Test 4: Check Express
console.log('\nTest 4: Loading Express...');
try {
  const express = require('express');
  console.log('✅ Express loaded successfully');
} catch (e) {
  console.error('❌ Express failed to load:', e.message);
  if (e.stack) console.error(e.stack);
}

// Test 5: Check CORS
console.log('\nTest 5: Loading CORS...');
try {
  const cors = require('cors');
  console.log('✅ CORS loaded successfully');
} catch (e) {
  console.error('❌ CORS failed to load:', e.message);
  if (e.stack) console.error(e.stack);
}

console.log('\n✅ Diagnostic complete');
