// 🔒 ULTRA MINIMAL SERVER - ABSOLUTE MINIMUM
// NO file operations, NO imports from app.js, NO nothing

console.log('🔒 [ULTRA MINIMAL] Starting server...');

const express = require('express');
const cors = require('cors');

const app = express();

// Minimal setup
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'success',
    message: 'ULTRA MINIMAL MODE - Zero file operations',
    timestamp: new Date().toISOString(),
  });
});

// 404
app.all('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found (ULTRA MINIMAL MODE)',
  });
});

// Start server
const port = parseInt(process.env.PORT || 4000, 10);
const host = process.env.HOST || '0.0.0.0';

const server = app.listen(port, host, () => {
  console.log('✅ [ULTRA MINIMAL] Server running');
  console.log(`   http://${host}:${port}`);
  console.log('   Test: curl http://localhost:4000/health');
});

server.on('error', (err) => {
  console.error('❌ Server error:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

// Error handlers
process.on('unhandledRejection', (err) => {
  console.error('🚨 UNHANDLED REJECTION:', err.message);
  if (err.stack) console.error(err.stack);
});

process.on('uncaughtException', (err) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
