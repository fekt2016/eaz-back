const mongoose = require('mongoose');
require('dotenv').config({ path: __dirname + '/.env' });
const { getZoneFromNeighborhoodName } = require('./src/utils/getZoneFromNeighborhood');

const zones = [
    { name: 'A', minKm: 0, maxKm: 5, baseRate: 20, perKgRate: 2, sameDayMultiplier: 1.5, expressMultiplier: 1.2, estimatedDays: '1-2', isActive: true, createdAt: new Date(), updatedAt: new Date(), __v: 0 },
    { name: 'B', minKm: 5.01, maxKm: 10, baseRate: 30, perKgRate: 2.5, sameDayMultiplier: 1.5, expressMultiplier: 1.2, estimatedDays: '1-2', isActive: true, createdAt: new Date(), updatedAt: new Date(), __v: 0 },
    { name: 'C', minKm: 10.01, maxKm: 15, baseRate: 40, perKgRate: 3.0, sameDayMultiplier: 1.5, expressMultiplier: 1.2, estimatedDays: '1-2', isActive: true, createdAt: new Date(), updatedAt: new Date(), __v: 0 },
    { name: 'D', minKm: 15.01, maxKm: 25, baseRate: 50, perKgRate: 3.5, sameDayMultiplier: 1.5, expressMultiplier: 1.2, estimatedDays: '2-3', isActive: true, createdAt: new Date(), updatedAt: new Date(), __v: 0 },
    { name: 'E', minKm: 25.01, maxKm: 40, baseRate: 65, perKgRate: 4.0, sameDayMultiplier: 1.5, expressMultiplier: 1.2, estimatedDays: '2-3', isActive: true, createdAt: new Date(), updatedAt: new Date(), __v: 0 },
    { name: 'F', minKm: 40.01, maxKm: 100, baseRate: 80, perKgRate: 5.0, sameDayMultiplier: 1.5, expressMultiplier: 1.2, estimatedDays: '2-3', isActive: true, createdAt: new Date(), updatedAt: new Date(), __v: 0 },
];

const url = process.env.MONGO_URL
    ? process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD || '')
    : process.env.MONGODB_URI;

mongoose.connect(url).then(async () => {
    try {
        const db = mongoose.connection.db;
        const shippingzones = db.collection('shippingzones');
        for (const zone of zones) {
            await shippingzones.findOneAndUpdate({ name: zone.name }, { $set: zone }, { upsert: true });
            console.log('Seeded zone:', zone.name);
        }

        const result = await getZoneFromNeighborhoodName('Nima', 'Accra');
        console.log('✅ Success:', JSON.stringify(result, null, 2));
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
    process.exit();
}).catch(console.error);
