const Admin = require('../Models/adminModel');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const handleFactory = require('../Controllers/handleFactory');

exports.getMe = catchAsync(async (req, res, next) => {
  const data = await Admin.findById(req.user.id);
  if (!data) return next(new AppError('User with the ID does not exits', 404));
  res.status(200).json({
    status: 'success',
    data: {
      data,
    },
  });
});

exports.deleteMe = catchAsync(async (req, res, next) => {
  const admin = await Admin.findByIdAndUpdate(req.user.id, { active: false });

  if (!admin) return next(new AppError('User with the ID does not exits', 404));

  res.status(204).json({
    status: 'success',
    data: null,
  });
});

exports.getAllAdmins = handleFactory.getAll(Admin);
exports.updateAdmin = handleFactory.updateOne(Admin);
exports.getAdmin = handleFactory.getOne(Admin);
exports.updateMe = handleFactory.updateOne(Admin);
exports.deleteAdmin = handleFactory.deleteOne(Admin);
