// const Order = require('../Models/orderModel');
const Sequence = require('../Models/sequenceModel');
randomTxt = () => Math.random().toString(36).substring(7).toLocaleUpperCase();
randomNumbers = () => Math.floor(1000 + Math.random() * 9000);
const mongoose = require('mongoose');

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
const validateGhanaPhone = (phone) => {
  if (!phone) return true; // Phone is optional

  // Remove all non-digit characters
  const cleanedPhone = phone.replace(/\D/g, '');

  // Check for valid Ghana formats:
  // 1. Local format: 0XXXXXXXXX (10 digits)
  // 2. International format: 233XXXXXXXXX (12 digits)
  const localRegex = /^0\d{9}$/;
  const intlRegex = /^233\d{9}$/;

  return localRegex.test(cleanedPhone) || intlRegex.test(cleanedPhone);
};

module.exports = {
  randomTxt,
  randomNumbers,
  generateOrderNumber,
  validateGhanaPhone,
};
