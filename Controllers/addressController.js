const { default: mongoose } = require('mongoose');
const Address = require('../Models/addressModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

// Get all addresses for current user
exports.getAddresses = catchAsync(async (req, res, next) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const addresses = await Address.find({ user: userId });

  if (!addresses) next(new AppError('No addresses found', 404));

  res.json({
    status: 'success',
    results: addresses.length,
    data: { addresses },
  });
});

// Create new address
exports.createAddress = catchAsync(async (req, res, next) => {
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

    res
      .status(201)
      .json({ success: true, message: 'Address created', address });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Update address
exports.updateAddress = catchAsync(async (req, res) => {
  const { isDefault, id, ...updateData } = req.body;
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
});

// Delete address
exports.deleteAddress = catchAsync(async (req, res, next) => {
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
});

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

exports.getUserAddresses = catchAsync(async (req, res, next) => {
  console.log('user id', req.user.id);
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const addresses = await Address.find({ user: userId });
  if (!addresses) next(new AppError('No address found', 404));
  res
    .status(200)
    .json({ status: 'success', message: 'Address found', data: { addresses } });
});
exports.getAddress = catchAsync(async (req, res, next) => {
  const address = await Address.findById(req.params.id);
  if (!address) next(new AppError('No address found', 404));
  res.json({ success: true, message: 'Address found', address });
});
