const mongoose = require('mongoose');

const userAddressSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  street: String,
  city: String,
  state: String,
  postalCode: String,
  country: String,
  isDefault: {
    type: Boolean,
    default: false,
  },
});
