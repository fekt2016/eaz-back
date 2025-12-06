const mongoose = require('mongoose');
const AppError = require('../utils/errors/appError');

/**
 * SECURITY FIX #6: Object ID Validation Middleware
 * Validates MongoDB ObjectID format to prevent:
 * - Invalid ID injection
 * - Database query errors
 * - Potential NoSQL injection vectors
 * 
 * Usage:
 *   router.get('/order/:id', validateObjectId('id'), getOrder);
 *   router.patch('/product/:productId', validateObjectId('productId'), updateProduct);
 */

/**
 * Validates that a route parameter is a valid MongoDB ObjectID
 * @param {string} paramName - Name of the parameter to validate (default: 'id')
 * @returns {Function} Express middleware function
 */
exports.validateObjectId = (paramName = 'id') => {
    return (req, res, next) => {
        const id = req.params[paramName];

        if (!id) {
            return next(new AppError(`Parameter '${paramName}' is required`, 400));
        }

        if (!mongoose.Types.ObjectId.isValid(id)) {
            console.error(`[Security] Invalid ObjectID format for ${paramName}: ${id}`);
            return next(new AppError(`Invalid ${paramName} format`, 400));
        }

        next();
    };
};

/**
 * Validates multiple ObjectID parameters at once
 * @param {string[]} paramNames - Array of parameter names to validate
 * @returns {Function} Express middleware function
 * 
 * Usage:
 *   router.post('/transfer/:fromId/:toId', validateMultipleObjectIds(['fromId', 'to Id']), transfer);
 */
exports.validateMultipleObjectIds = (paramNames = []) => {
    return (req, res, next) => {
        for (const paramName of paramNames) {
            const id = req.params[paramName];

            if (!id) {
                return next(new AppError(`Parameter '${paramName}' is required`, 400));
            }

            if (!mongoose.Types.ObjectId.isValid(id)) {
                console.error(`[Security] Invalid ObjectID format for ${paramName}: ${id}`);
                return next(new AppError(`Invalid ${paramName} format`, 400));
            }
        }

        next();
    };
};

/**
 * Validates ObjectID in request body
 * @param {string} fieldName - Name of the field to validate
 * @param {boolean} required - Whether the field is required (default: true)
 * @returns {Function} Express middleware function
 */
exports.validateBodyObjectId = (fieldName, required = true) => {
    return (req, res, next) => {
        const id = req.body[fieldName];

        if (!id && required) {
            return next(new AppError(`Field '${fieldName}' is required`, 400));
        }

        if (id && !mongoose.Types.ObjectId.isValid(id)) {
            console.error(`[Security] Invalid ObjectID format for ${fieldName}: ${id}`);
            return next(new AppError(`Invalid ${fieldName} format`, 400));
        }

        next();
    };
};

/**
 * Validates ObjectID in query string
 * @param {string} queryName - Name of the query parameter to validate
 * @param {boolean} required - Whether the parameter is required (default: false)
 * @returns {Function} Express middleware function
 */
exports.validateQueryObjectId = (queryName, required = false) => {
    return (req, res, next) => {
        const id = req.query[queryName];

        if (!id && required) {
            return next(new AppError(`Query parameter '${queryName}' is required`, 400));
        }

        if (id && !mongoose.Types.ObjectId.isValid(id)) {
            console.error(`[Security] Invalid ObjectID format for ${queryName}: ${id}`);
            return next(new AppError(`Invalid ${queryName} format`, 400));
        }

        next();
    };
};
