/**
 * Seeder Script: Generate 10 Sample Products for Each Seller
 * 
 * This script:
 * - Fetches all sellers from the database
 * - Generates 10 products per seller (mix of new and used)
 * - Uses existing categories from the database
 * - Generates realistic product data with variants
 * - Does NOT modify or delete existing products
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Product = require('../models/product/productModel');
const Seller = require('../models/user/sellerModel');
const Category = require('../models/category/categoryModel');
const logger = require('../utils/logger');

// Product data templates by category
const PRODUCT_TEMPLATES = {
  electronics: {
    names: [
      'Wireless Bluetooth Headphones',
      'Smartphone Case with Stand',
      'USB-C Charging Cable',
      'Portable Power Bank',
      'Wireless Mouse',
      'Mechanical Keyboard',
      'HD Webcam',
      'USB Flash Drive',
      'Phone Screen Protector',
      'Laptop Stand',
    ],
    brands: ['Samsung', 'Apple', 'Sony', 'Logitech', 'Anker', 'Belkin', 'JBL', 'Xiaomi'],
    descriptions: [
      'High-quality product with excellent features and durability.',
      'Premium design with modern technology for everyday use.',
      'Reliable and efficient solution for your needs.',
      'Stylish and functional product that delivers great performance.',
      'Perfect combination of quality and affordability.',
    ],
    attributes: {
      Color: ['Black', 'White', 'Blue', 'Red', 'Silver', 'Gold'],
      Size: ['Small', 'Medium', 'Large', 'One Size'],
      Storage: ['32GB', '64GB', '128GB', '256GB'],
      Capacity: ['5000mAh', '10000mAh', '20000mAh'],
    },
  },
  fashion: {
    names: [
      'Classic Cotton T-Shirt',
      'Denim Jeans',
      'Leather Belt',
      'Canvas Sneakers',
      'Baseball Cap',
      'Wool Sweater',
      'Silk Scarf',
      'Leather Wallet',
      'Cotton Shorts',
      'Hooded Jacket',
    ],
    brands: ['Nike', 'Adidas', 'Puma', 'Levi\'s', 'Zara', 'H&M', 'Gap', 'Uniqlo'],
    descriptions: [
      'Comfortable and stylish design perfect for everyday wear.',
      'Made from high-quality materials for long-lasting durability.',
      'Trendy design that never goes out of style.',
      'Perfect fit with attention to detail and craftsmanship.',
      'Versatile piece that complements any wardrobe.',
    ],
    attributes: {
      Color: ['Black', 'White', 'Navy', 'Grey', 'Beige', 'Brown'],
      Size: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
      Material: ['Cotton', 'Polyester', 'Leather', 'Wool', 'Silk'],
    },
  },
  home: {
    names: [
      'Ceramic Coffee Mug',
      'Kitchen Knife Set',
      'Bed Sheet Set',
      'Table Lamp',
      'Throw Pillow',
      'Wall Clock',
      'Storage Basket',
      'Desk Organizer',
      'Picture Frame',
      'Candle Holder',
    ],
    brands: ['IKEA', 'HomeGoods', 'Target', 'Walmart', 'Amazon Basics', 'OXO'],
    descriptions: [
      'Beautiful and functional addition to your home.',
      'Durable construction designed for everyday use.',
      'Elegant design that enhances your living space.',
      'Practical solution with modern aesthetics.',
      'High-quality materials for lasting performance.',
    ],
    attributes: {
      Color: ['White', 'Beige', 'Grey', 'Brown', 'Black', 'Blue'],
      Size: ['Small', 'Medium', 'Large'],
      Material: ['Ceramic', 'Wood', 'Metal', 'Fabric', 'Glass'],
    },
  },
  beauty: {
    names: [
      'Face Moisturizer',
      'Lipstick Set',
      'Hair Brush',
      'Nail Polish',
      'Face Mask',
      'Body Lotion',
      'Perfume',
      'Makeup Brush Set',
      'Hair Serum',
      'Sunscreen',
    ],
    brands: ['L\'Oreal', 'Maybelline', 'Revlon', 'Nivea', 'Olay', 'Neutrogena'],
    descriptions: [
      'Nourishing formula for healthy and radiant skin.',
      'Long-lasting color with smooth application.',
      'Professional quality for salon-like results.',
      'Gentle on skin with natural ingredients.',
      'Effective solution for your beauty routine.',
    ],
    attributes: {
      Color: ['Red', 'Pink', 'Nude', 'Brown', 'Black', 'Clear'],
      Size: ['50ml', '100ml', '200ml', '500ml'],
      Type: ['Normal', 'Dry', 'Oily', 'Combination'],
    },
  },
  sports: {
    names: [
      'Yoga Mat',
      'Resistance Bands',
      'Water Bottle',
      'Gym Bag',
      'Jump Rope',
      'Dumbbells Set',
      'Foam Roller',
      'Exercise Ball',
      'Running Shorts',
      'Sports Watch',
    ],
    brands: ['Nike', 'Adidas', 'Under Armour', 'Reebok', 'Puma', 'New Balance'],
    descriptions: [
      'Designed for optimal performance and comfort.',
      'Durable construction for intense workouts.',
      'Lightweight and portable for on-the-go fitness.',
      'Ergonomic design for maximum effectiveness.',
      'Professional-grade equipment for serious athletes.',
    ],
    attributes: {
      Color: ['Black', 'Blue', 'Red', 'Grey', 'Green'],
      Size: ['Small', 'Medium', 'Large'],
      Weight: ['1kg', '2kg', '5kg', '10kg'],
    },
  },
};

// Condition distribution (30% used, 70% new)
const CONDITIONS = [
  { type: 'new', weight: 7 },
  { type: 'used', weight: 3 },
];

/**
 * Get random item from array
 */
function getRandomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Get weighted random condition
 */
function getRandomCondition() {
  const totalWeight = CONDITIONS.reduce((sum, c) => sum + c.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const condition of CONDITIONS) {
    random -= condition.weight;
    if (random <= 0) {
      return condition.type;
    }
  }
  return 'new';
}

/**
 * Generate random number in range
 */
function randomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate random float in range
 */
function randomFloat(min, max, decimals = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

/**
 * Generate unique SKU
 */
function generateSKU(sellerId, productIndex, variantIndex, timestamp) {
  const sellerPrefix = sellerId.toString().substring(18, 24).toUpperCase(); // Last 6 chars of ObjectId
  const timeSuffix = timestamp.toString().substring(6); // Last digits of timestamp
  const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${sellerPrefix}-${String(productIndex).padStart(3, '0')}-${String(variantIndex).padStart(2, '0')}-${timeSuffix}${randomSuffix}`;
}

/**
 * Generate product variants based on category
 */
function generateVariants(categoryTemplate, productIndex, sellerId, timestamp) {
  const variants = [];
  const numVariants = randomNumber(1, 4); // 1-4 variants per product
  
  // Get available attributes for this category
  const attributeKeys = Object.keys(categoryTemplate.attributes);
  
  // Generate base attributes
  const baseAttributes = {};
  attributeKeys.forEach((key) => {
    const values = categoryTemplate.attributes[key];
    if (values && values.length > 0) {
      baseAttributes[key] = getRandomItem(values);
    }
  });
  
  // Generate variants
  for (let i = 0; i < numVariants; i++) {
    const variantAttributes = [];
    const variantPrice = randomFloat(20, 500);
    const originalPrice = variantPrice * randomFloat(1.1, 1.5); // 10-50% markup
    
    // Add attributes
    Object.keys(baseAttributes).forEach((key) => {
      const values = categoryTemplate.attributes[key];
      let value = baseAttributes[key];
      
      // For first variant, use base value; for others, vary it
      if (i > 0 && values.length > 1) {
        value = getRandomItem(values);
      }
      
      variantAttributes.push({
        key,
        value: String(value),
      });
    });
    
    // Add size if not already present and category supports it
    if (!baseAttributes.Size && Math.random() > 0.5) {
      variantAttributes.push({
        key: 'Size',
        value: getRandomItem(['S', 'M', 'L', 'XL']),
      });
    }
    
    variants.push({
      attributes: variantAttributes,
      price: Math.round(variantPrice * 100) / 100,
      originalPrice: Math.round(originalPrice * 100) / 100,
      stock: randomNumber(5, 200),
      sku: generateSKU(sellerId, productIndex, i, timestamp),
      status: 'active',
      images: [],
      weight: {
        value: randomNumber(100, 5000),
        unit: 'g',
      },
      dimensions: {
        length: randomNumber(10, 50),
        width: randomNumber(10, 50),
        height: randomNumber(5, 30),
        unit: 'cm',
      },
      lowStockThreshold: 5,
    });
  }
  
  return variants;
}

/**
 * Generate product images (using placeholder)
 */
function generateImages(productName, count = 3) {
  const images = [];
  for (let i = 0; i < count; i++) {
    // Use placeholder images
    images.push(`https://via.placeholder.com/600x600?text=${encodeURIComponent(productName)}`);
  }
  return images;
}

/**
 * Generate fake product data
 */
function generateFakeProductData(categoryTemplate, parentCategory, subCategory, sellerId, productIndex, timestamp) {
  // Each product has ONE condition: either 'new' OR 'used', never both
  const condition = getRandomCondition();
  const baseName = getRandomItem(categoryTemplate.names);
  const brand = getRandomItem(categoryTemplate.brands);
  
  // Make product name unique by adding seller identifier and timestamp
  // Note: Don't add "(Used)" to name - the condition field is the single source of truth
  const sellerShortId = sellerId.toString().substring(18, 24); // Last 6 chars of ObjectId
  const uniqueSuffix = timestamp.toString().substring(8, 13); // Last 5 digits
  const productName = `${brand} ${baseName} - ${sellerShortId}${uniqueSuffix}`;
  const description = getRandomItem(categoryTemplate.descriptions);
  const shortDescription = description.substring(0, 160);
  
  // Adjust price for used products (30-50% discount)
  const basePrice = randomFloat(20, 500);
  const priceMultiplier = condition === 'used' ? randomFloat(0.5, 0.7) : 1;
  const finalPrice = basePrice * priceMultiplier;
  
  // Generate variants
  const variants = generateVariants(categoryTemplate, productIndex, sellerId, timestamp);
  
  // Adjust variant prices for used condition
  if (condition === 'used') {
    variants.forEach((variant) => {
      variant.price = Math.round(variant.price * priceMultiplier * 100) / 100;
      variant.originalPrice = variant.price * randomFloat(1.1, 1.3);
    });
  }
  
  // Generate images
  const images = generateImages(productName, randomNumber(3, 5));
  const imageCover = images[0];
  
  // Generate tags
  const tags = [
    baseName.toLowerCase(),
    brand.toLowerCase(),
    condition, // Only one condition per product
    parentCategory.name.toLowerCase(),
    subCategory.name.toLowerCase(),
  ];
  
  // Generate keywords
  const keywords = [
    productName,
    brand,
    `${brand} ${baseName}`,
    `${condition} ${baseName}`,
  ];
  
  // Generate ratings (used products have slightly lower ratings)
  const baseRating = condition === 'used' 
    ? randomFloat(3.0, 4.5) 
    : randomFloat(3.5, 5.0);
  const ratingsQuantity = randomNumber(0, 100);
  
  // Calculate rating distribution
  const ratingDistribution = {
    5: Math.floor(ratingsQuantity * (baseRating >= 4.5 ? 0.6 : 0.4)),
    4: Math.floor(ratingsQuantity * 0.3),
    3: Math.floor(ratingsQuantity * 0.1),
    2: Math.floor(ratingsQuantity * 0.05),
    1: Math.floor(ratingsQuantity * 0.05),
  };
  
  // Generate specifications
  const specifications = {
    material: [
      {
        value: getRandomItem(['Cotton', 'Polyester', 'Leather', 'Plastic', 'Metal', 'Wood']),
        hexCode: '#000000',
      },
    ],
    weight: {
      value: randomNumber(100, 5000),
      unit: 'g',
    },
    dimensions: {
      length: randomNumber(10, 50),
      width: randomNumber(10, 50),
      height: randomNumber(5, 30),
      unit: 'cm',
    },
    color: [
      {
        name: getRandomItem(['Black', 'White', 'Blue', 'Red', 'Grey']),
        hexCode: '#000000',
      },
    ],
  };
  
  // Generate product data
  // Each product has exactly ONE condition value: 'new' OR 'used' (never both)
  const productData = {
    seller: sellerId,
    isEazShopProduct: false,
    name: productName, // Clean name without condition suffix - condition field is the source of truth
    description: condition === 'used' 
      ? `${description} This is a pre-owned item in good condition.` 
      : description,
    shortDescription,
    imageCover,
    images,
    parentCategory: parentCategory._id,
    subCategory: subCategory._id,
    categoryPath: `${parentCategory.name}/${subCategory.name}`,
    variants,
    price: Math.round(finalPrice * 100) / 100,
    minPrice: Math.min(...variants.map(v => v.price)),
    maxPrice: Math.max(...variants.map(v => v.price)),
    brand,
    manufacturer: {
      name: brand,
      sku: `MFG-${brand.toUpperCase().substring(0, 3)}-${randomNumber(1000, 9999)}`,
    },
    status: 'active',
    condition, // This is the key field for used products
    shippingType: randomNumber(1, 10) > 8 ? 'heavy' : 'normal',
    tags,
    keywords,
    metaTitle: `${brand} ${baseName} - ${parentCategory.name}`,
    metaDescription: shortDescription,
    socialMedia: {
      facebook: true,
      instagram: true,
      twitter: false,
    },
    totalSold: randomNumber(0, 50),
    totalViews: randomNumber(0, 500),
    ratingsQuantity,
    ratingsAverage: baseRating,
    ratingDistribution,
    specifications,
    shipping: {
      weight: {
        value: randomNumber(100, 5000),
        unit: 'g',
      },
      dimensions: {
        length: randomNumber(10, 50),
        width: randomNumber(10, 50),
        height: randomNumber(5, 30),
        unit: 'cm',
      },
      freeShipping: Math.random() > 0.7,
      shippingClass: 'standard',
    },
    tax: {
      taxable: true,
      taxClass: 'standard',
    },
    availability: {
      startDate: new Date(),
      status: 'available',
    },
  };
  
  return productData;
}

/**
 * Main seeder function
 */
async function seedSellerProducts() {
  try {
    // Connect to MongoDB
    let mongodb;
    if (process.env.MONGO_URL) {
      mongodb = process.env.MONGO_URL.replace(
        '<PASSWORD>',
        process.env.DATABASE_PASSWORD || ''
      );
    } else if (process.env.MONGODB_URI) {
      mongodb = process.env.MONGODB_URI;
    } else if (process.env.DATABASE) {
      mongodb = process.env.DATABASE.replace(
        '<PASSWORD>',
        process.env.DATABASE_PASSWORD || ''
      );
    } else {
      throw new Error('No MongoDB connection string found in environment variables');
    }
    
    await mongoose.connect(mongodb, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    logger.info('✅ Connected to MongoDB');
    
    // Step 1: Fetch all sellers
    const sellers = await Seller.find({});
    logger.info(`\n📦 Found ${sellers.length} sellers`);
    
    if (sellers.length === 0) {
      logger.info('⚠️  No sellers found in database. Please create sellers first.');
      await mongoose.connection.close();
      process.exit(0);
    }
    
    // Step 2: Fetch active categories
    const parentCategories = await Category.find({ 
      parentCategory: null, 
      status: 'active' 
    });
    
    logger.info(`📂 Found ${parentCategories.length} parent categories`);
    
    if (parentCategories.length === 0) {
      logger.info('⚠️  No categories found. Please create categories first.');
      await mongoose.connection.close();
      process.exit(0);
    }
    
    // Get all subcategories (categories with parentCategory set)
    const subCategories = await Category.find({
      parentCategory: { $ne: null },
      status: 'active',
    }).populate('parentCategory');
    
    logger.info(`📂 Found ${subCategories.length} subcategories`);
    
    if (subCategories.length === 0) {
      logger.info('⚠️  No subcategories found. Please create subcategories first.');
      await mongoose.connection.close();
      process.exit(0);
    }
    
    // Build category pairs array
    const allSubCategories = subCategories
      .filter((sub) => sub.parentCategory) // Ensure parent exists
      .map((sub) => ({
        parent: sub.parentCategory,
        sub,
      }));
    
    if (allSubCategories.length === 0) {
      logger.info('⚠️  No valid category pairs found. Please create subcategories with valid parents.');
      await mongoose.connection.close();
      process.exit(0);
    }
    
    logger.info(`📂 Using ${allSubCategories.length} category pairs\n`);
    
    // Step 3: Map category names to templates
    const categoryTemplateMap = {
      electronics: PRODUCT_TEMPLATES.electronics,
      fashion: PRODUCT_TEMPLATES.fashion,
      clothing: PRODUCT_TEMPLATES.fashion,
      home: PRODUCT_TEMPLATES.home,
      'home & kitchen': PRODUCT_TEMPLATES.home,
      beauty: PRODUCT_TEMPLATES.beauty,
      sports: PRODUCT_TEMPLATES.sports,
      fitness: PRODUCT_TEMPLATES.sports,
    };
    
    // Step 4: Generate products for each seller
    let totalProductsGenerated = 0;
    const productsPerSeller = 10;
    
    for (const seller of sellers) {
      logger.info(`\n🛍️  Processing seller: ${seller.shopName || seller.name} (${seller.email});`);
      
      const sellerProducts = [];
      
      for (let i = 0; i < productsPerSeller; i++) {
        // Get random category pair
        const categoryPair = getRandomItem(allSubCategories);
        const parentCategory = categoryPair.parent;
        const subCategory = categoryPair.sub;
        
        // Find matching template (case-insensitive)
        const parentNameLower = parentCategory.name.toLowerCase();
        let template = null;
        
        for (const [key, value] of Object.entries(categoryTemplateMap)) {
          if (parentNameLower.includes(key)) {
            template = value;
            break;
          }
        }
        
        // Fallback to electronics if no match
        if (!template) {
          template = PRODUCT_TEMPLATES.electronics;
        }
        
  // Generate unique timestamp for this batch
  const batchTimestamp = Date.now();
  
  // Generate unique timestamp for each product
  const productTimestamp = batchTimestamp + i + Math.floor(Math.random() * 1000);
  
  // Generate product data
  const productData = generateFakeProductData(
    template,
    parentCategory,
    subCategory,
    seller._id,
    i,
    productTimestamp, // Make each product unique
  );
        
        sellerProducts.push(productData);
      }
      
      // Insert products for this seller
      try {
        const createdProducts = await Product.insertMany(sellerProducts, { ordered: false });
        totalProductsGenerated += createdProducts.length;
        
        // Count new vs used
        const newCount = createdProducts.filter(p => p.condition === 'new').length;
        const usedCount = createdProducts.filter(p => p.condition === 'used').length;
        
        logger.info(`   ✅ Added ${createdProducts.length} products (${newCount} new, ${usedCount} used);`);
      } catch (error) {
        logger.error(`   ❌ Error inserting products for ${seller.shopName}:`, error.message);
        // Continue with next seller
      }
    }
    
    // Step 5: Update seller product counts
    logger.info('\n📊 Updating seller product counts...');
    for (const seller of sellers) {
      await Seller.updateProductCount(seller._id);
    }
    
    // Final summary
    logger.info('\n' + '='.repeat(60));
    logger.info('✅ SEEDING COMPLETE');
    logger.info('='.repeat(60));
    logger.info(`Total sellers processed: ${sellers.length}`);
    logger.info(`Total products generated: ${totalProductsGenerated}`);
    logger.info(`Average products per seller: ${(totalProductsGenerated / sellers.length).toFixed(1)}`);
    logger.info('='.repeat(60) + '\n');
    
    // Close connection
    await mongoose.connection.close();
    logger.info('✅ Database connection closed');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error seeding products:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run seeder
if (require.main === module) {
  seedSellerProducts();
}

module.exports = seedSellerProducts;

