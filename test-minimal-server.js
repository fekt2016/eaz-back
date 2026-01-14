// 🔒 ULTRA MINIMAL TEST - NO FILE OPERATIONS
// Test if Express itself works without any app code

console.log('🔒 Starting ultra minimal server test...');

const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: 'ULTRA_MINIMAL_TEST' });
});

const port = 4001; // Use different port to avoid conflicts
const server = app.listen(port, () => {
  console.log(`✅ Ultra minimal server started on port ${port}`);
  console.log('   Test: curl http://localhost:4001/health');
  console.log('   If this works, the error is in server.js or app.js');
  
  // Auto-close after 5 seconds
  setTimeout(() => {
    server.close();
    console.log('✅ Test complete - server closed');
    process.exit(0);
  }, 5000);
});

server.on('error', (err) => {
  console.error('❌ Server error:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
