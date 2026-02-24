require('dotenv').config({ path: __dirname + '/.env' });
const mongoose = require('mongoose');

async function testCartCalc() {
  const DB = process.env.MONGO_URL.replace('<PASSWORD>', process.env.DATABASE_PASSWORD);
  await mongoose.connect(DB);

  let totalLogisticsRevenue = 0;
  
  // Mixed cart mimicking a multi-vendor checkout 
  const products = [
    { 
      _id: "p1", fulfillmentType: 'express', 
      category: { shippingContribution: { dropship: 15, express: 10 } } 
    },
    { 
      _id: "p2", fulfillmentType: 'dropship', 
      category: { shippingContribution: { dropship: 8, express: 6 } } 
    },
    { 
      _id: "p3", fulfillmentType: 'dropship', 
      // Missing category contribution (fallback to 0)
      category: {} 
    }
  ];

  // Seller 1 items (p1 x 2) & (p3 x 1)
  const seller1Items = [
    { product: "p1", quantity: 2 },
    { product: "p3", quantity: 1 }
  ];

  // Seller 2 items (p2 x 1)
  const seller2Items = [
    { product: "p2", quantity: 1 }
  ];
  
  // SIMULATE CONTROLLER LOGIC
  const processSeller = (sellerItems, label) => {
      let sellerShippingContribution = 0;
      sellerItems.forEach(item => {
        const p = products.find(prod => prod._id === item.product);
        if (p && p.category && p.category.shippingContribution) {
          const fulfillment = p.fulfillmentType === 'express' ? 'express' : 'dropship';
          const flatRate = p.category.shippingContribution[fulfillment] || 0;
          sellerShippingContribution += (flatRate * item.quantity);
        }
      });
      sellerShippingContribution = Math.round(sellerShippingContribution * 100) / 100;
      totalLogisticsRevenue += sellerShippingContribution;
      console.log(`[${label}] Shipping Contribution: GHS ${sellerShippingContribution}`);
  };

  processSeller(seller1Items, "Seller 1");
  processSeller(seller2Items, "Seller 2");

  console.log(`[Total Order] Logistics Revenue: GHS ${totalLogisticsRevenue}`);
  process.exit();
}

testCartCalc();
