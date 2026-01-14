// 🔒 ABSOLUTE MINIMUM - NOTHING BUT EXPRESS
// This is the smallest possible server

const express = require('express');
const app = express();

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server on ${port}`));
