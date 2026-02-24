require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');

async function testPickup() {
  const DB = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
  await mongoose.connect(DB);

  const PickupCenter = require('./src/models/shipping/pickupCenterModel');
  const centers = await PickupCenter.find({});
  console.log('All Pickup Centers:', centers);

  const activeCenters = await PickupCenter.find({ isActive: true });
  console.log('Active Pickup Centers:', activeCenters);

  process.exit();
}

testPickup();
