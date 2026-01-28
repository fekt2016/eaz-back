const Admin = require('../../models/user/adminModel');
const AppError = require('../../utils/errors/appError');
const catchAsync = require('../../utils/helpers/catchAsync');
const handleFactory = require('../shared/handleFactory');

exports.getMe = catchAsync(async (req, res, next) => {
  try {
    // Use lean() to avoid building full Mongoose documents – this keeps
    // /admin/me fast and reduces memory/CPU under heavy load.
    const data = await Admin.findById(req.user.id).lean();
    if (!data) return next(new AppError('User with the ID does not exits', 404));
    return res.status(200).json({
      status: 'success',
      data: {
        data,
      },
    });
  } catch (error) {
    // Defensive guard so this endpoint never hangs and contributes to timeouts.
    return next(new AppError('Failed to fetch admin data', 500));
  }
});

exports.deleteMe = catchAsync(async (req, res, next) => {
  const admin = await Admin.findByIdAndUpdate(req.user.id, { active: false });

  if (!admin) return next(new AppError('User with the ID does not exits', 404));

  res.status(204).json({data: null, status: 'success'});
});

exports.getAllAdmins = handleFactory.getAll(Admin);
exports.updateAdmin = handleFactory.updateOne(Admin);
exports.getAdmin = handleFactory.getOne(Admin);
exports.updateMe = handleFactory.updateOne(Admin);
exports.deleteAdmin = handleFactory.deleteOne(Admin);
