const mongoose = require('mongoose');
const dotenv = require('dotenv');
const PickupCenter = require('../src/models/shipping/pickupCenterModel');

// Load environment variables
dotenv.config({ path: './.env' });

// Connect to database
const mongodb = process.env.MONGO_URL.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD
);

mongoose
  .connect(mongodb, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log('✅ Database connection successful!');
    console.log(`MongoDB Host: ${mongoose.connection.host}, Database: ${mongoose.connection.name}`);
  })
  .catch((err) => {
    console.error('❌ Database connection error:', err);
    process.exit(1);
  });

// Seed pickup centers
const seedPickupCenters = async () => {
  try {
    // Clear existing pickup centers (optional - comment out if you want to keep existing ones)
    // await PickupCenter.deleteMany({});
    // console.log('🗑️  Cleared existing pickup centers');

    // Check if pickup center already exists
    const existingCenter = await PickupCenter.findOne({
      address: /E1\/12.*Nima Highway/i,
    });

    if (existingCenter) {
      console.log('ℹ️  Pickup center already exists:', existingCenter.pickupName);
      console.log('   Skipping seed...');
      await mongoose.connection.close();
      process.exit(0);
    }

    // Create first pickup center
    const pickupCenter = await PickupCenter.create({
      pickupName: 'EazShop Nima Pickup Center',
      address: 'E1/12 Nima Highway St, Nima, Accra, Ghana',
      city: 'ACCRA',
      area: 'Nima',
      googleMapLink: 'https://maps.google.com/?q=E1/12+Nima+Highway+St,+Nima,+Accra,+Ghana',
      instructions: 'Please bring a valid ID when collecting your order. Our pickup center is located on Nima Highway, easily accessible by public transport.',
      openingHours: 'Monday - Friday: 9:00 AM - 6:00 PM, Saturday: 9:00 AM - 4:00 PM',
      isActive: true,
    });

    console.log('✅ Successfully created pickup center:');
    console.log('   Name:', pickupCenter.pickupName);
    console.log('   Address:', pickupCenter.address);
    console.log('   City:', pickupCenter.city);
    console.log('   Area:', pickupCenter.area);
    console.log('   Opening Hours:', pickupCenter.openingHours);

    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding pickup centers:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
};

// Run seed function
seedPickupCenters();

