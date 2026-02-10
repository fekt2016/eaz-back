const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Seller = require('../src/models/user/sellerModel');
const bcrypt = require('bcryptjs');

// Load environment variables
dotenv.config({ path: './.env' });

// EazShop Seller ID constant
const EAZSHOP_SELLER_ID = new mongoose.Types.ObjectId('6970b22eaba06cadfd4b8035');

async function seedEazShopSeller() {
  try {
    // Connect to database
    const DB = process.env.DATABASE.replace(
      '<PASSWORD>',
      process.env.DATABASE_PASSWORD
    );

    await mongoose.connect(DB);
    console.log('✅ Database connection successful');

    // Check if EazShop seller already exists
    const existingSeller = await Seller.findById(EAZSHOP_SELLER_ID);
    
    if (existingSeller) {
      console.log('ℹ️  EazShop seller already exists. Updating...');
      
      // Update existing seller
      existingSeller.role = 'eazshop_store';
      existingSeller.shopName = 'EazShop Official Store';
      existingSeller.verificationStatus = 'verified';
      existingSeller.status = 'active';
      existingSeller.active = true;
      
      // Add ownerType and canBeDeleted fields if they don't exist
      if (!existingSeller.ownerType) {
        existingSeller.ownerType = 'system';
      }
      if (existingSeller.canBeDeleted === undefined) {
        existingSeller.canBeDeleted = false;
      }
      
      await existingSeller.save();
      console.log('✅ EazShop seller updated successfully');
    } else {
      // Create new EazShop seller
      const hashedPassword = await bcrypt.hash('EazShop@2024!', 12);
      
      const eazshopSeller = await Seller.create({
        _id: EAZSHOP_SELLER_ID,
        name: 'EazShop Official',
        shopName: 'EazShop Official Store',
        email: 'store@eazshop.com',
        password: hashedPassword,
        passwordConfirm: hashedPassword,
        role: 'eazshop_store',
        verificationStatus: 'verified',
        status: 'active',
        active: true,
        ownerType: 'system',
        canBeDeleted: false,
        shopAddress: {
          city: 'ACCRA',
          region: 'Greater Accra',
        },
        location: 'ACCRA',
        shopDescription: 'Official EazShop store - Trusted • Verified • Fast Delivery',
      });

      console.log('✅ EazShop seller created successfully');
      console.log('   ID:', eazshopSeller._id);
      console.log('   Store Name:', eazshopSeller.shopName);
      console.log('   Email:', eazshopSeller.email);
    }

    console.log('\n✅ Seeding completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding EazShop seller:', error);
    process.exit(1);
  }
}

// Run the seed function
seedEazShopSeller();

