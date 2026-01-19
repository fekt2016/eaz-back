const User = require('../../models/user/userModel');
const AppError = require('../../utils/errors/appError');
const catchAsync = require('../../utils/helpers/catchAsync');
const handleFactory = require('../shared/handleFactory');
const multer = require('multer');
const sharp = require('sharp');
const stream = require('stream');
const logger = require('../../utils/logger');
const { logActivityAsync } = require('../../modules/activityLog/activityLog.service');

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
  logger.info('file', req.file);
  if (!req.file) return next();

  // Get Cloudinary instance from app
  const cloudinary = req.app.get('cloudinary');
  
  if (!cloudinary) {
    // Fallback to local storage if Cloudinary is not configured
    req.file.filename = `user-${req.user.id}-${Date.now()}.jpeg`;
    await sharp(req.file.buffer)
      .resize(500, 500)
      .toFormat('jpeg')
      .jpeg({ quality: 90 })
      .toFile(`public/img/users/${req.file.filename}`);
    return next();
  }

  // Use Sharp to optimize image before uploading to Cloudinary
  const optimizedBuffer = await sharp(req.file.buffer)
    .resize(500, 500, {
      fit: 'cover',
      position: 'center',
    })
    .toFormat('jpeg')
    .jpeg({ quality: 90 })
    .toBuffer();

  // Upload to Cloudinary
  const result = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'user-avatars',
        public_id: `user-${req.user.id}-${Date.now()}`,
        transformation: [
          { width: 500, height: 500, crop: 'fill', gravity: 'face' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
        resource_type: 'image',
      },
      (error, result) => {
        if (error) {
          return reject(new AppError(`Image upload failed: ${error.message}`, 500));
        }
        resolve(result);
      },
    );

    // Create buffer stream from optimized image
    const bufferStream = new stream.PassThrough();
    bufferStream.end(optimizedBuffer);
    bufferStream.pipe(uploadStream);
  });

  // Store Cloudinary URL in req.file for use in controller
  req.file.cloudinaryUrl = result.secure_url;
  req.file.publicId = result.public_id;
  
  next();
});

exports.upLoadUserAvatar = catchAsync(async (req, res, next) => {
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        'This route is not for password updates, Please use updatemyPassword',
        400,
      ),
    );
  }

  // Check if file was uploaded
  if (!req.file) {
    return next(new AppError('Please upload an image file', 400));
  }

  // Use Cloudinary URL if available, otherwise use local filename
  const photo = req.file.cloudinaryUrl || req.file.filename;

  // Update user with photo
  const user = await User.findByIdAndUpdate(
    req.user.id,
    { photo },
    {
      new: true,
      runValidators: true,
      select: '-password -passwordConfirm', // Exclude sensitive fields
    },
  );

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      user,
      imageInfo: req.file.cloudinaryUrl ? {
        url: req.file.cloudinaryUrl,
        publicId: req.file.publicId,
      } : undefined,
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
  const filteredBody = filterObj(req.body, 'name', 'email', 'phone', 'gender', 'dateOfBirth');
  const updatedUser = await User.findByIdAndUpdate(req.user.id, filteredBody, {
    new: true,
    runValidators: true,
  });

  // Log activity
  logActivityAsync({
    userId: req.user.id,
    role: 'buyer',
    action: 'UPDATE_PROFILE',
    description: `User updated profile information`,
    req,
  });

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser,
    },
  });
});

exports.deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user.id, {
    active: false,
    status: 'inactive',
  });

  res.status(204).json({ data: null, status: 'success' });
});
exports.getMe = catchAsync(async (req, res, next) => {
  // User is already attached to req.user by protect middleware
  // Just return it instead of querying again
  if (!req.user) {
    return next(new AppError('You are not authenticated', 401));
  }
  
  // Optionally refresh from database to get latest data
  const data = await User.findById(req.user.id);
  
  if (!data) {
    // User was deleted after authentication - clear the session
    return next(new AppError('Your account no longer exists. Please contact support.', 404));
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
