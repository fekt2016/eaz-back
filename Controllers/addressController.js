const Address = require('../models/addressModel');
const catchAsync = require('../utils/catchAsync');

// Get all addresses for current user
exports.getAddresses = catchAsync(async (req, res) => {
  console.log(req.user.id);
  try {
    const addresses = await Address.find({ user: req.user.id });
    res.json({ success: true, addresses });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create new address
exports.createAddress = catchAsync(async (req, res, next) => {
  console.log('req.body', req.body);
  const userId = req.user.id;

  try {
    const { isDefault, ...addressData } = req.body;
    const address = new Address({
      user: userId,
      ...addressData,
    });

    if (isDefault) {
      await Address.updateMany(
        { user: req.user.id },
        { $set: { isDefault: false } },
      );
      address.isDefault = true;
    }
    await address.save();
    console.log('address', address);
    res
      .status(201)
      .json({ success: true, message: 'Address created', address });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Update address
exports.updateAddress = async (req, res) => {
  try {
    const { isDefault, ...updateData } = req.body;
    const address = await Address.findOne({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!address) {
      return res
        .status(404)
        .json({ success: false, message: 'Address not found' });
    }

    Object.assign(address, updateData);

    if (isDefault) {
      await Address.updateMany(
        { user: req.user.id, _id: { $ne: req.params.id } },
        { $set: { isDefault: false } },
      );
      address.isDefault = true;
    }

    await address.save();
    res.json({ success: true, message: 'Address updated', address });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Delete address
exports.deleteAddress = async (req, res) => {
  try {
    const address = await Address.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });

    if (!address) {
      return res
        .status(404)
        .json({ success: false, message: 'Address not found' });
    }

    // If deleted address was default, set a new default if available
    if (address.isDefault) {
      const newDefault = await Address.findOne({ user: req.user.id });
      if (newDefault) {
        newDefault.isDefault = true;
        await newDefault.save();
      }
    }

    res.json({ success: true, message: 'Address deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Set default address
exports.setDefaultAddress = async (req, res) => {
  try {
    await Address.updateMany(
      { user: req.user.id },
      { $set: { isDefault: false } },
    );

    const address = await Address.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { $set: { isDefault: true } },
      { new: true },
    );

    if (!address) {
      return res
        .status(404)
        .json({ success: false, message: 'Address not found' });
    }

    res.json({ success: true, message: 'Default address updated', address });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
