const mongoose = require('mongoose');

const testimonialSchema = new mongoose.Schema(
  {
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Seller',
      required: [true, 'Testimonial must belong to a seller'],
      index: true,
    },
    content: {
      type: String,
      required: [true, 'Testimonial content is required'],
      trim: true,
      minlength: [10, 'Testimonial must be at least 10 characters'],
      maxlength: [500, 'Testimonial cannot exceed 500 characters'],
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required'],
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating cannot exceed 5'],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    adminNote: {
      type: String,
      trim: true,
      maxlength: [300, 'Admin note cannot exceed 300 characters'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index for efficient queries
testimonialSchema.index({ seller: 1, createdAt: -1 });
testimonialSchema.index({ status: 1, isPublished: 1, createdAt: -1 });

// One active testimonial per seller (pending/approved).
testimonialSchema.index(
  { seller: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'approved'] } },
  }
);

module.exports = mongoose.model('Testimonial', testimonialSchema);
