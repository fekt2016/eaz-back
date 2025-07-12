const Product = require('../Models/productModel');
const APIFeature = require('../utils/apiFeatures');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const mongoose = require('mongoose');

exports.deleteOne = (Model) =>
  catchAsync(async (req, res, next) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return next(new AppError('Invalid product ID format', 400));
    }

    const doc = await Model.findByIdAndDelete(req.params.id);
    if (!doc) {
      return next(new AppError('No documnet found with that ID', 404));
    }
    res.status(200).json({
      status: 'success',
      data: null,
    });
  });

exports.updateOne = (Model) =>
  catchAsync(async (req, res, next) => {
    if (req.body.orderStatus && Object.keys(req.body).length > 1) {
      return next(
        new AppError('Order update should only modify order status', 400),
      );
    }

    // Special handling for Category model
    if (Model.modelName === 'Category' && req.body.variantStructure) {
      // Parse JSON string if needed
      if (typeof req.body.variantStructure === 'string') {
        try {
          req.body.variantStructure = JSON.parse(req.body.variantStructure);
        } catch (error) {
          return next(new AppError('Invalid variantStructure format', 400));
        }
      }

      const doc = await Model.findById(req.params.id);
      if (!doc) {
        return next(new AppError('No document found with that ID', 404));
      }

      // Update document manually
      Object.keys(req.body).forEach((key) => {
        if (req.body[key] !== undefined && req.body[key] !== null) {
          doc[key] = req.body[key];
        }
      });

      // Trigger save middleware
      const updatedDoc = await doc.save();

      return res.status(200).json({
        status: 'success',
        doc: updatedDoc,
      });
    }

    // General update for other models
    const doc = await Model.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!doc) {
      return next(new AppError('No document found with that ID', 404));
    }

    res.status(200).json({
      status: 'success',
      doc,
    });
  });

exports.createOne = (Model) => async (req, res, next) => {
  console.log('body', req.body);
  const { file } = req;

  try {
    if (Model)
      if (!req.body || Object.keys(req.body).length === 0) {
        if (file) {
          // 1. Handle image upload
          const cloudinary = req.app.get('cloudinary');
          const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { folder: 'product' },
              (error, result) => {
                if (error) reject(new AppError('Image upload failed', 500));
                resolve(result);
              },
            );
            stream.end(file.buffer);
          });
          req.body.image = result.secure_url;
        }
        // 2. Validate request body
        return next(new AppError('Request body cannot be empty', 400));
      }

    // 3. Create document
    const doc = await Model.create(req.body);

    //4. Send response
    res.status(201).json({
      status: 'success',
      doc,
    });
  } catch (err) {
    next(err);
  }
};

exports.getOne = (Model, popOptions) =>
  catchAsync(async (req, res, next) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return next(new AppError('Invalid ID format', 400));
    }

    let query = Model.findById(req.params.id);
    if (popOptions) query = query.populate(popOptions);

    const doc = await query;

    if (!doc) {
      return next(new AppError('doc with this ID is not found', 404));
    }

    res.status(200).json({ status: 'success', data: { data: doc } });
  });

exports.getAll = (Model, popOptions) =>
  catchAsync(async (req, res, next) => {
    console.log('testing');
    let filter = {};
    if (req.params.productId) filter = { product: req.params.productId };
    if (req.query.search) {
      const search = req.query.search;
      filter = {
        ...filter,
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
        ],
      };
    }
    let query = Model.find(filter);
    if (popOptions) {
      if (Array.isArray(popOptions)) {
        popOptions.forEach((option) => {
          query = query.populate(option);
        });
      } else {
        query = query.populate(popOptions);
      }
    }

    const features = new APIFeature(query, req.query)
      .filter()
      .sort()
      .limitFields()
      .paginate();

    const results = await features.query;

    const meta = await features.getMeta();

    if (!results || results.length === 0) {
      return next(new AppError('No documents found', 404));
    }

    res.status(200).json({
      status: 'success',
      results: results.length,
      results,
      meta,
    });
  });
