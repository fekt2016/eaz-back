const validator = require('validator');
const AppError = require('../utils/errors/appError');

/**
 * SECURITY FIX #21: Enhanced Email and Phone Validation Middleware
 * Provides stricter validation for emails and Ghana phone numbers
 */

exports.validateEmail = (req, res, next) => {
    const email = req.body.email;

    if (!email) {
        return next();  // Let required validation happen elsewhere
    }

    // SECURITY: Use validator.js for robust email validation
    if (!validator.isEmail(email)) {
        return next(new AppError('Please provide a valid email address', 400));
    }

    // Additional checks
    if (email.length > 254) { // RFC 5321
        return next(new AppError('Email address is too long', 400));
    }

    // Normalize email (lowercase, trim)
    req.body.email = validator.normalizeEmail(email, {
        gmail_remove_dots: false, // Keep dots in Gmail
    });

    next();
};

exports.validatePhone = (req, res, next) => {
    const phone = req.body.phone || req.body.phoneNumber;

    if (!phone) {
        return next(); // Let required validation happen elsewhere
    }

    // SECURITY: Ghana phone format validation
    // Format: +233XXXXXXXXX or 0XXXXXXXXX (10 digits after 0, or 9 after +233)
    const phoneStr = String(phone).trim();

    // Remove spaces and hyphens
    const cleanPhone = phoneStr.replace(/[\s-]/g, '');

    // Check Ghana phone patterns
    const ghanaPattern1 = /^\+233[0-9]{9}$/; // +233XXXXXXXXX
    const ghanaPattern2 = /^0[0-9]{9}$/;     // 0XXXXXXXXX
    const ghanaPattern3 = /^233[0-9]{9}$/;   // 233XXXXXXXXX

    if (!ghanaPattern1.test(cleanPhone) &&
        !ghanaPattern2.test(cleanPhone) &&
        !ghanaPattern3.test(cleanPhone)) {
        return next(new AppError('Please provide a valid Ghana phone number (e.g., +233XXXXXXXXX or 0XXXXXXXXX)', 400));
    }

    // Normalize to +233 format
    let normalizedPhone;
    if (cleanPhone.startsWith('+233')) {
        normalizedPhone = cleanPhone;
    } else if (cleanPhone.startsWith('233')) {
        normalizedPhone = '+' + cleanPhone;
    } else if (cleanPhone.startsWith('0')) {
        normalizedPhone = '+233' + cleanPhone.substring(1);
    }

    req.body.phone = normalizedPhone;
    if (req.body.phoneNumber) {
        req.body.phoneNumber = normalizedPhone;
    }

    next();
};
