/**
 * validateVariantAttributes.js
 *
 * Middleware that validates variant attribute keys and values
 * against the subcategory's allowed attributes.
 *
 * Skips validation if the subcategory has no attributes defined
 * (backwards-compatible with categories that haven't been configured yet).
 */
const Category = require('../models/category/categoryModel');
const AppError = require('../utils/errors/appError');
const catchAsync = require('../utils/helpers/catchAsync');
const logger = require('../utils/logger');

const validateVariantAttributes = catchAsync(async (req, res, next) => {
    // Only validate when variants are present
    let variants = req.body.variants;
    if (!variants) return next();

    // Parse if string (FormData sends JSON as string)
    if (typeof variants === 'string') {
        try {
            variants = JSON.parse(variants);
            req.body.variants = variants;
        } catch {
            return next(new AppError('Invalid variants format', 400));
        }
    }

    if (!Array.isArray(variants) || variants.length === 0) return next();

    // Determine subcategory ID from body or existing product
    const subCategoryId = req.body.subCategory || req.body.subcategory;
    if (!subCategoryId) return next(); // Can't validate without a subcategory

    // Fetch the subcategory
    const subcategory = await Category.findById(subCategoryId).lean();
    if (!subcategory) return next(); // Non-existent subcategory will be caught by product controller

    const allowedAttributes = subcategory.attributes || [];
    // If subcategory has no attributes defined, skip validation (backwards-compatible)
    if (allowedAttributes.length === 0) return next();

    // Build a lookup map: lowercase name → attribute definition
    const attrMap = {};
    for (const attr of allowedAttributes) {
        attrMap[attr.name.toLowerCase()] = attr;
    }

    // Validate each variant
    const errors = [];
    for (let i = 0; i < variants.length; i++) {
        const variantAttrs = variants[i].attributes;
        if (!variantAttrs || !Array.isArray(variantAttrs)) continue;

        // Check for required attributes
        for (const attr of allowedAttributes) {
            if (attr.isRequired && attr.isVariant !== false) {
                const found = variantAttrs.some(
                    (a) => a.key && a.key.toLowerCase() === attr.name.toLowerCase() && a.value
                );
                if (!found) {
                    errors.push(`Variant ${i + 1}: missing required attribute "${attr.name}"`);
                }
            }
        }

        // Check each provided attribute
        for (const va of variantAttrs) {
            if (!va.key) continue;

            const def = attrMap[va.key.toLowerCase()];
            if (!def) {
                errors.push(
                    `Variant ${i + 1}: unknown attribute "${va.key}". Allowed: ${allowedAttributes
                        .map((a) => a.name)
                        .join(', ')}`
                );
                continue;
            }

            // Validate enum/color values
            if ((def.type === 'enum' || def.type === 'color') && def.values && def.values.length > 0) {
                if (va.value && !def.values.includes(va.value)) {
                    errors.push(
                        `Variant ${i + 1}: "${va.key}" value "${va.value}" is not allowed. Allowed values: ${def.values.join(
                            ', '
                        )}`
                    );
                }
            }
        }
    }

    if (errors.length > 0) {
        logger.warn('[validateVariantAttributes] Validation failed:', errors);
        return next(new AppError(`Variant attribute validation failed:\n${errors.join('\n')}`, 400));
    }

    next();
});

module.exports = validateVariantAttributes;
