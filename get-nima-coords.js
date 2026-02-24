const mongoose = require('mongoose');
require('dotenv').config({ path: __dirname + '/.env' });

const url = process.env.MONGO_URL
    ? process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD || '')
    : process.env.MONGODB_URI;

mongoose.connect(url).then(async () => {
    const db = mongoose.connection.db;
    const nima = await db.collection('neighborhoods').findOne({ name: /nima/i });
    console.log(JSON.stringify(nima, null, 2));
    process.exit();
}).catch(console.error);
