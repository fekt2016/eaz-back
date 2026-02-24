require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const ShippingZone = require('../models/shipping/shippingZoneModel');

const zones = [
    { name: 'A', minKm: 0, maxKm: 5, baseRate: 20, perKgRate: 2, sameDayMultiplier: 1.5, expressMultiplier: 1.2, estimatedDays: '1-2', isActive: true },
    { name: 'B', minKm: 5.01, maxKm: 10, baseRate: 30, perKgRate: 2.5, sameDayMultiplier: 1.5, expressMultiplier: 1.2, estimatedDays: '1-2', isActive: true },
    { name: 'C', minKm: 10.01, maxKm: 15, baseRate: 40, perKgRate: 3.0, sameDayMultiplier: 1.5, expressMultiplier: 1.2, estimatedDays: '1-2', isActive: true },
    { name: 'D', minKm: 15.01, maxKm: 25, baseRate: 50, perKgRate: 3.5, sameDayMultiplier: 1.5, expressMultiplier: 1.2, estimatedDays: '2-3', isActive: true },
    { name: 'E', minKm: 25.01, maxKm: 40, baseRate: 65, perKgRate: 4.0, sameDayMultiplier: 1.5, expressMultiplier: 1.2, estimatedDays: '2-3', isActive: true },
    { name: 'F', minKm: 40.01, maxKm: 100, baseRate: 80, perKgRate: 5.0, sameDayMultiplier: 1.5, expressMultiplier: 1.2, estimatedDays: '2-3', isActive: true },
];

async function seed() {
    const url = process.env.MONGO_URL
        ? process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD || '')
        : process.env.MONGODB_URI;

    await mongoose.connect(url);
    console.log('Connected to DB');

    for (const zone of zones) {
        await ShippingZone.findOneAndUpdate({ name: zone.name }, zone, { upsert: true, new: true });
        console.log(`Seeded zone ${zone.name}`);
    }

    process.exit(0);
}

seed().catch(console.error);
