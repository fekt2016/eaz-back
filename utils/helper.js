// const Order = require('../Models/orderModel');
const Sequence = require('../Models/sequenceModel');
randomTxt = () => Math.random().toString(36).substring(7).toLocaleUpperCase();
randomNumbers = () => Math.floor(1000 + Math.random() * 9000);
const mongoose = require('mongoose');

// const generateOrderNumber = async () => {
//   const today = new Date();
//   const datePart = `${today.getFullYear()}${(today.getMonth() + 1)
//     .toString()
//     .padStart(2, '0')}${today.getDate().toString().padStart(2, '0')}`;

//   // Find the last order number for today
//   const lastOrder = await Order.findOne({
//     orderNumber: new RegExp(`^ORD-${datePart}-`),
//   }).sort({ createdAt: -1 });

//   let sequence = 1;
//   if (lastOrder && lastOrder.orderNumber) {
//     const lastSeq = parseInt(lastOrder.orderNumber.split('-')[2], 10);
//     if (!isNaN(lastSeq)) sequence = lastSeq + 1;
//   }

//   return `ORD-${datePart}-${sequence.toString().padStart(4, '0')}`;
// };
const generateOrderNumber = async () => {
  const today = new Date();
  const datePart = `${today.getFullYear()}${(today.getMonth() + 1)
    .toString()
    .padStart(2, '0')}${today.getDate().toString().padStart(2, '0')}`;

  const sequenceName = `order-${datePart}`;

  try {
    const sequence = await Sequence.findOneAndUpdate(
      { _id: sequenceName },
      { $inc: { seq: 1 } },
      {
        new: true,
        upsert: true,
        session: mongoose.session, // Pass transaction session if exists
      },
    );

    return `ORD-${datePart}-${sequence.seq.toString().padStart(4, '0')}`;
  } catch (error) {
    console.error('Failed to generate order number:', error);
    // Fallback to timestamp + random number
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(1000 + Math.random() * 9000);
    return `ORD-${datePart}-${timestamp}${random}`;
  }
};

module.exports = {
  randomTxt,
  randomNumbers,
  generateOrderNumber,
};
