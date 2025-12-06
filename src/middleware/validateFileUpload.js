const AppError = require('../utils/errors/appError');

/**
 * SECURITY FIX #27: File Upload Validation Middleware
 * Validates MIME types and file sizes for uploads
 */

// Allowed MIME types by category
const ALLOWED_MIME_TYPES = {
    images: [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp',
        'image/gif',
    ],
    documents: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
};

// Maximum file sizes (in bytes)
const MAX_FILE_SIZES = {
    image: 5 * 1024 * 1024, // 5MB
    document: 10 * 1024 * 1024, // 10MB
    default: 2 * 1024 * 1024, // 2MB
};

/**
 * Validate image uploads (products, avatars, etc.)
 */
exports.validateImageUpload = (req, res, next) => {
    if (!req.files && !req.file) {
        return next(); // No files to validate
    }

    const files = req.files ? Object.values(req.files).flat() : [req.file];

    for (const file of files) {
        if (!file) continue;

        // SECURITY: Validate MIME type
        if (!ALLOWED_MIME_TYPES.images.includes(file.mimetype)) {
            return next(
                new AppError(
                    `Invalid file type. Only JPEG, PNG, WebP, and GIF images are allowed. Got: ${file.mimetype}`,
                    400
                )
            );
        }

        // SECURITY: Validate file size
        if (file.size > MAX_FILE_SIZES.image) {
            return next(
                new AppError(
                    `File size too large. Maximum size is ${MAX_FILE_SIZES.image / 1024 / 1024}MB`,
                    400
                )
            );
        }

        // SECURITY: Validate file extension matches MIME type
        const ext = file.originalname.split('.').pop().toLowerCase();
        const validExtensions = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
        if (!validExtensions.includes(ext)) {
            return next(
                new AppError(
                    `Invalid file extension. Only ${validExtensions.join(', ')} are allowed`,
                    400
                )
            );
        }
    }

    next();
};

/**
 * Validate document uploads
 */
exports.validateDocumentUpload = (req, res, next) => {
    if (!req.files && !req.file) {
        return next();
    }

    const files = req.files ? Object.values(req.files).flat() : [req.file];

    for (const file of files) {
        if (!file) continue;

        // SECURITY: Validate MIME type
        if (!ALLOWED_MIME_TYPES.documents.includes(file.mimetype)) {
            return next(
                new AppError(
                    'Invalid file type. Only PDF and Word documents are allowed',
                    400
                )
            );
        }

        // SECURITY: Validate file size
        if (file.size > MAX_FILE_SIZES.document) {
            return next(
                new AppError(
                    `File size too large. Maximum size is ${MAX_FILE_SIZES.document / 1024 / 1024}MB`,
                    400
                )
            );
        }
    }

    next();
};
