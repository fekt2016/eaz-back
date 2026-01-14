// 🔒 COMPLETELY CLEAN SERVER - NO IMPORTS FROM THIS PROJECT
// This file has ZERO dependencies on any project files

console.log('🔒 [CLEAN SERVER] Starting...');

// Only use external npm packages
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: 'CLEAN' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`✅ Clean server running on port ${port}`);
});

