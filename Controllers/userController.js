const User = require('../Models/userModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const handleFactory = require('../Controllers/handleFactory');
const multer = require('multer');
const sharp = require('sharp');

const multerStorage = multer.memoryStorage();

const multerFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image')) {
    cb(null, true);
  } else {
    cb(new AppError('Not an image! Please upload an image', 400), false);
  }
};

const upload = multer({ storage: multerStorage, fileFilter: multerFilter });

const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach((el) => {
    if (allowedFields.includes(el)) newObj[el] = obj[el];
  });
  return newObj;
};
exports.uploadUserPhoto = upload.single('photo');
exports.resizeUserPhoto = catchAsync(async (req, res, next) => {
  if (!req.file) return next();

  req.file.filename = `user-${req.user.id}-${Date.now()}.jpeg`;
  await sharp(req.file.buffer)
    .resize(500, 500)
    .toFormat('jpeg')
    .jpeg({ quality: 90 })
    .toFile(`public/img/users/${req.file.filename}`);
  next();
});

exports.upLoadUserAvatar = catchAsync(async (req, res, next) => {
  console.log('red', req.body);
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates, Please use updatemyPassword',
        400,
      ),
    );
  }
  if (req.file) req.body.photo = req.file.filename;

  const userPhoto = await User.findByIdAndUpdate(req.body.photo, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: 'success',
    data: {
      user: userPhoto,
    },
  });
});
exports.updateMe = catchAsync(async (req, res, next) => {
  // 1) Create error if user Posts password  data
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates, Please use updatemyPassword',
        400,
      ),
    );
  }
  //2) Update user document
  const filteredBody = filterObj(req.body, 'name', 'email');
  if (req.file) filteredBody.photo = req.file.filename;
  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser,
    },
  });
});

exports.deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user.id, { active: false });

  res.status(204).json({
    status: 'success',
    data: null,
  });
});
exports.getMe = catchAsync(async (req, res, next) => {
  console.log('get me');
  const data = await User.findById(req.user.id);

  if (!data) {
    return next(new AppError('No user found with that ID', 404));
  }
  res.status(200).json({ status: 'success', data });
});

exports.userCount = catchAsync(async (req, res, next) => {
  const userCount = await User.countDocuments();
  if (!userCount) {
    return next(new AppError('No users found', 404));
  }
  res.status(200).json({ status: 'success', data: { userCount } });
});

exports.getMeId = (req, res, next) => {
  req.params.id = req.user.id;

  next();
};

exports.getProfile = catchAsync(async (req, res, next) => {
  // Determine which user profile to show
  const userId =
    req.user.role === 'admin' && req.params.id ? req.params.id : req.user.id;

  // Fetch user with necessary fields
  const user = await User.findById(userId)
    .select('+securitySettings') // Include virtual field
    .populate('wishList')
    .populate('permissions')
    .lean();

  if (!user) {
    return next(new AppError('No user found with that ID', 404));
  }

  const profileData = {
    userInfo: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      photo: user.photo,
      role: user.role,
      address: user.address,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      ...(user.role === 'seller' && {
        businessName: user.businessName,
        taxId: user.taxId,
      }),
    },
    securitySettings: user.securitySettings || {},
    connectedAccounts: user.connectedAccounts || {},
    permissions: user.permissions || {},
  };

  // Structure the response to match frontend expectations

  res.status(200).json({
    status: 'success',
    data: profileData,
  });
});

exports.getAllUsers = handleFactory.getAll(User);
exports.updateUser = handleFactory.updateOne(User);
exports.deleteUser = handleFactory.deleteOne(User);
exports.getUser = handleFactory.getOne(User);
exports.createUser = handleFactory.createOne(User);
