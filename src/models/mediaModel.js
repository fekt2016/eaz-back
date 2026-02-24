const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema(
    {
        url: {
            type: String,
            required: [true, 'Media URL is required'],
        },
        public_id: {
            type: String,
            required: [true, 'Media public_id is required'],
        },
        hash: {
            type: String,
            required: [true, 'Media hash is required'],
            unique: true,
            index: true,
        },
        uploadedBy: {
            type: mongoose.Schema.ObjectId,
            ref: 'User',
            required: [true, 'Media must belong to a user'],
        },
        format: String,
        resource_type: {
            type: String,
            default: 'image',
        },
        bytes: Number,
        width: Number,
        height: Number,
    },
    {
        timestamps: true,
    }
);

// Enforce unique index on hash at database level
mediaSchema.index({ hash: 1 }, { unique: true });

const Media = mongoose.model('Media', mediaSchema);

module.exports = Media;
