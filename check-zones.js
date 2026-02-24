const mongoose = require('mongoose');
require('dotenv').config({ path: __dirname + '/.env' });

const url = process.env.MONGO_URL
    ? process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD || '')
    : process.env.MONGODB_URI;

mongoose.connect(url).then(async () => {
    const db = mongoose.connection.db;
    const zones = await db.collection('shippingzones').find({}).toArray();
    console.log('Zones:', JSON.stringify(zones, null, 2));
    process.exit();
}).catch(console.error);
