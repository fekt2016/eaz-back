require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');

async function seed() {
  const DB = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
  await mongoose.connect(DB);
  
  const PickupCenter = require('./src/models/shipping/pickupCenterModel');
  
  const centers = [
      {
          pickupName: "Saiisai Main Office - Accra",
          address: "123 Independence Avenue, Ridge",
          city: "ACCRA",
          area: "Ridge",
          instructions: "Located next to the central bank. Bring your order ID.",
          openingHours: "Monday - Saturday: 8:00 AM - 6:00 PM"
      },
      {
          pickupName: "Saiisai Hub - Tema",
          address: "Community 1, Market Circle",
          city: "TEMA",
          area: "Community 1",
          instructions: "Located inside the main mall.",
          openingHours: "Monday - Saturday: 9:00 AM - 5:00 PM"
      }
  ];
  
  await PickupCenter.insertMany(centers);
  console.log("Successfully seeded default pickup centers.");
  process.exit();
}

seed();
