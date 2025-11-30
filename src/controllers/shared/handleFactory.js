const APIFeature = require('../../utils/helpers/apiFeatures');
const AppError = require('../../utils/errors/appError');
const catchAsync = require('../../utils/helpers/catchAsync');
const mongoose = require('mongoose');
// import cloudinary from '../../utils/storage/cloudinary.js';
// import { uploadToCloudinary } from '../../utils/storage/cloudinary.js';

exports.deleteOne = (Model) =>
  catchAsync(async (req, res, next) => {
    console.log('req.params', req.params.id);
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
    console.log('body', req.body);
    // Order model specific validation
    if (req.body.orderStatus && Object.keys(req.body).length > 1) {
      return next(
        new AppError('Order update should only modify order status', 400),
      );
    }

    // Handle Category model with attributes
    if (Model.modelName === 'Category' && req.body.attributes) {
      try {
        // Parse attributes if it's a string
        if (req.body.variants && typeof req.body.variants === 'string') {
          try {
            req.body.variants = JSON.parse(req.body.variants);
          } catch (err) {
            return next(new AppError('Invalid variants format', 400));
          }
        }

        // Parse attributes if sent as string
        if (req.body.attributes && typeof req.body.attributes === 'string') {
          try {
            req.body.attributes = JSON.parse(req.body.attributes);
          } catch (err) {
            return next(new AppError('Invalid attributes format', 400));
          }
        }
        console.log('attributes', req.body.attributes);
        // Parse attributes if sent as string
        if (typeof req.body.attributes === 'string') {
          req.body.attributes = JSON.parse(req.body.attributes);
        }
        // Validate attributes structure
        if (!Array.isArray(req.body.attributes)) {
          return next(new AppError('Attributes must be an array', 400));
        }
        // Validate each attribute
        for (const attr of req.body.attributes) {
          if (!attr.name || typeof attr.name !== 'string') {
            return next(new AppError('Attribute must have a name string', 400));
          }
          if (
            !['text', 'number', 'boolean', 'enum', 'color'].includes(attr.type)
          ) {
            return next(
              new AppError(`Invalid attribute type: ${attr.type}`, 400),
            );
          }
          if (
            (attr.type === 'enum' || attr.type === 'color') &&
            (!Array.isArray(attr.values) || attr.values.length === 0)
          ) {
            return next(
              new AppError(
                `${attr.name} requires values for enum/color types`,
                400,
              ),
            );
          }
        }
      } catch (error) {
        return next(new AppError('Invalid attributes format', 400));
      }
      const categoryId = new mongoose.Types.ObjectId(req.params.id);
      const doc = await Model.findById(categoryId);
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
  // console.log(req.files);
  // console.log('req.body', req.body);
  try {
    // const { files } = req;
    let body = req.body;

    if (body.attributes && typeof body.attributes === 'string') {
      try {
        body.attributes = JSON.parse(body.attributes);
      } catch (err) {
        return next(new AppError('Invalid attributes format', 400));
      }
    }

    if (body.variants && typeof body.variants === 'string') {
      try {
        body.variants = JSON.parse(body.variants);
        console.log('varaints', body.variants);
      } catch (err) {
        return next(new AppError('Invalid variants format', 400));
      }
    }

    // Ensure variants is an array
    if (body.variants && !Array.isArray(body.variants)) {
      return next(new AppError('Variants must be an array', 400));
    }

    // Transform variants data types
    if (body.variants) {
      body.variants = body.variants.map((variant) => ({
        ...variant,
        price: parseFloat(variant.price) || 0,
        stock: parseInt(variant.stock) || 0,
      }));
    }

    // Handle parentCategory
    if (body.parentCategory === 'null' || body.parentCategory === 'undefined') {
      body.parentCategory = null;
    }

    // Validate ObjectIDs
    if (body.parentCategory && !mongoose.isValidObjectId(body.parentCategory)) {
      return next(new AppError('Invalid parentCategory ID format', 400));
    }

    if (body.subCategory && !mongoose.isValidObjectId(body.subCategory)) {
      return next(new AppError('Invalid subCategory ID format', 400));
    }
    console.log();
    // 3. Create document
    const doc = await Model.create(body);

    // 4. Send response
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
    // let query;

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return next(new AppError('Invalid ID format', 400));
    }

    let query = Model.findById(req.params.id);
    if (Array.isArray(popOptions) || popOptions)
      query = query.populate(popOptions);

    const doc = await query;
    console.log('doc', doc);

    if (!doc) {
      return next(new AppError('doc with this ID is not found', 404));
    }
    console.log('doc', doc);
    res.status(200).json({ status: 'success', data: { data: doc } });
  });

exports.getAll = (Model, popOptions) =>
  catchAsync(async (req, res, next) => {
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

    // Return empty array instead of error if no results found
    // This allows pagination to work correctly even when there are no documents
    res.status(200).json({
      status: 'success',
      results: results || [],
      meta,
    });
  });

// Export all functions (already exported individually above)
// Keep individual exports for backward compatibility
