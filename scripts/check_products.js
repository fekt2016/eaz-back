const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' });
const Product = require('../src/models/product/productModel');
const Category = require('../src/models/category/categoryModel');
const Seller = require('../src/models/user/sellerModel');

const DB = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
mongoose.connect(DB).then(async () => {
    console.log("Connected to DB");
    const products = await Product.find({}).populate('parentCategory').populate('seller', 'name verificationStatus');
    console.log("\nProducts in DB:");
    for (let p of products) {
        console.log(`- ${p.name}`);
        console.log(`  Category: ${p.parentCategory ? p.parentCategory.name : 'None'} (${p.parentCategory ? p.parentCategory._id : ''})`);
        console.log(`  Seller: ${p.seller ? p.seller.name : 'None'} (Verified: ${p.seller ? p.seller.verificationStatus : 'N/A'})`);
        console.log(`  Status: ${p.status}, Moderation: ${p.moderationStatus}, isVisible: ${p.isVisible}`);
        console.log(`  Deleted: ${p.isDeleted}`);
    }
    process.exit(0);
});
