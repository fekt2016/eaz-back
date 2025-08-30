const catchAsync = require('../utils/catchAsync');
const { validationResult } = require('express-validator');
// @desc    Search products using route parameter
// @route   GET /api/products/search/:query
// @access  Public
const Product = require('../Models/productModel');
const Category = require('../Models/categoryModel'); // Make sure to import Category

exports.searchProducts = catchAsync(async (req, res, next) => {
  console.log('Search query received:', req.params.query);
  //   try {
  //     // Validate request
  //     const errors = validationResult(req);
  //     if (!errors.isEmpty()) {
  //       return res.status(400).json({
  //         success: false,
  //         message: 'Validation error',
  //         errors: errors.array(),
  //       });
  //     }

  //     const { query } = req.params;
  //     const {
  //       parentCategory,
  //       minPrice,
  //       maxPrice,
  //       sortBy,
  //       page = 1,
  //       limit = 10,
  //     } = req.query;

  //     // Decode the search query from URL parameter
  //     const searchTerm = decodeURIComponent(query);

  //     // Build search query
  //     let searchQuery = { status: 'active' };

  //     // First, find categories that match the search term
  //     let categoryIds = [];

  //     if (searchTerm) {
  //       const matchingCategories = await Category.find({
  //         name: { $regex: searchTerm, $options: 'i' },
  //       }).select('_id');

  //       categoryIds = matchingCategories.map((cat) => cat._id);

  //       // Text search across multiple fields
  //       searchQuery.$or = [
  //         { name: { $regex: searchTerm, $options: 'i' } },
  //         { description: { $regex: searchTerm, $options: 'i' } },
  //         { tags: { $regex: searchTerm, $options: 'i' } },
  //         { brand: { $regex: searchTerm, $options: 'i' } },
  //       ];

  //       // Only add category search if we found matching categories
  //       if (categoryIds.length > 0) {
  //         searchQuery.$or.push({ parentCategory: { $in: categoryIds } });
  //       }
  //     }

  //     // Category filter (if provided as a query parameter)
  //     if (parentCategory) {
  //       searchQuery.parentCategory = parentCategory;
  //     }

  //     // Price range filter
  //     if (minPrice || maxPrice) {
  //       searchQuery['variants.price'] = {};
  //       if (minPrice) searchQuery['variants.price'].$gte = Number(minPrice);
  //       if (maxPrice) searchQuery['variants.price'].$lte = Number(maxPrice);
  //     }

  //     // Sort options
  //     let sortOptions = {};
  //     switch (sortBy) {
  //       case 'price_asc':
  //         sortOptions = { 'variants.price': 1 };
  //         break;
  //       case 'price_desc':
  //         sortOptions = { 'variants.price': -1 };
  //         break;
  //       case 'newest':
  //         sortOptions = { createdAt: -1 };
  //         break;
  //       case 'oldest':
  //         sortOptions = { createdAt: 1 };
  //         break;
  //       case 'rating':
  //         sortOptions = { averageRating: -1 };
  //         break;
  //       default:
  //         sortOptions = { createdAt: -1 };
  //     }

  //     // Pagination
  //     const pageNum = parseInt(page);
  //     const limitNum = parseInt(limit);
  //     const skip = (pageNum - 1) * limitNum;

  //     // Execute search with aggregation
  //     const aggregationPipeline = [
  //       { $match: searchQuery },

  //       // Unwind variants to filter and sort properly
  //       { $unwind: '$variants' },

  //       // Filter variants to only include active ones with stock
  //       { $match: { 'variants.status': 'active', 'variants.stock': { $gt: 0 } } },

  //       // Apply price filter if specified
  //       ...(minPrice || maxPrice
  //         ? [
  //             {
  //               $match: {
  //                 'variants.price': {
  //                   ...(minPrice ? { $gte: Number(minPrice) } : {}),
  //                   ...(maxPrice ? { $lte: Number(maxPrice) } : {}),
  //                 },
  //               },
  //             },
  //           ]
  //         : []),

  //       // Group back by product
  //       {
  //         $group: {
  //           _id: '$_id',
  //           doc: { $first: '$$ROOT' },
  //           variants: { $push: '$variants' },
  //           minPrice: { $min: '$variants.price' },
  //           maxPrice: { $max: '$variants.price' },
  //         },
  //       },

  //       // Replace the root with the original document but with filtered variants
  //       {
  //         $replaceRoot: {
  //           newRoot: {
  //             $mergeObjects: ['$doc', { variants: '$variants' }],
  //           },
  //         },
  //       },

  //       // Add relevance scoring if there's a search term
  //       ...(searchTerm
  //         ? [
  //             {
  //               $addFields: {
  //                 relevance: {
  //                   $add: [
  //                     {
  //                       $cond: {
  //                         if: {
  //                           $regexMatch: {
  //                             input: '$name',
  //                             regex: searchTerm,
  //                             options: 'i',
  //                           },
  //                         },
  //                         then: 10,
  //                         else: 0,
  //                       },
  //                     },
  //                     {
  //                       $cond: {
  //                         if: {
  //                           $regexMatch: {
  //                             input: '$description',
  //                             regex: searchTerm,
  //                             options: 'i',
  //                           },
  //                         },
  //                         then: 5,
  //                         else: 0,
  //                       },
  //                     },
  //                     {
  //                       $cond: {
  //                         if: {
  //                           $regexMatch: {
  //                             input: { $toString: '$brand' },
  //                             regex: searchTerm,
  //                             options: 'i',
  //                           },
  //                         },
  //                         then: 3,
  //                         else: 0,
  //                       },
  //                     },
  //                   ],
  //                 },
  //               },
  //             },
  //           ]
  //         : [{ $addFields: { relevance: 0 } }]),

  //       // Lookup for parent category details
  //       {
  //         $lookup: {
  //           from: 'categories',
  //           localField: 'parentCategory',
  //           foreignField: '_id',
  //           as: 'parentCategoryDetails',
  //         },
  //       },

  //       // Lookup for sub category details
  //       {
  //         $lookup: {
  //           from: 'categories',
  //           localField: 'subCategory',
  //           foreignField: '_id',
  //           as: 'subCategoryDetails',
  //         },
  //       },

  //       // Sort results
  //       { $sort: { relevance: -1, ...sortOptions } },

  //       // Pagination
  //       { $skip: skip },
  //       { $limit: limitNum },

  //       // Project the final results - Create a 'category' field for UI compatibility
  //       {
  //         $project: {
  //           name: 1,
  //           description: 1,
  //           imageCover: 1,
  //           images: 1,
  //           brand: 1,
  //           variants: 1,
  //           // Create a 'category' field that matches what the UI expects
  //           category: {
  //             $cond: {
  //               if: { $gt: [{ $size: '$parentCategoryDetails' }, 0] },
  //               then: {
  //                 _id: { $arrayElemAt: ['$parentCategoryDetails._id', 0] },
  //                 name: { $arrayElemAt: ['$parentCategoryDetails.name', 0] },
  //               },
  //               else: {
  //                 _id: '$parentCategory', // Keep the original ID
  //                 name: 'Uncategorized',
  //               },
  //             },
  //           },
  //           // Keep the original parentCategory field for backward compatibility
  //           parentCategory: {
  //             $cond: {
  //               if: { $gt: [{ $size: '$parentCategoryDetails' }, 0] },
  //               then: {
  //                 _id: { $arrayElemAt: ['$parentCategoryDetails._id', 0] },
  //                 name: { $arrayElemAt: ['$parentCategoryDetails.name', 0] },
  //               },
  //               else: {
  //                 _id: '$parentCategory', // Keep the original ID
  //                 name: 'Uncategorized',
  //               },
  //             },
  //           },
  //           subCategory: {
  //             $cond: {
  //               if: { $gt: [{ $size: '$subCategoryDetails' }, 0] },
  //               then: {
  //                 _id: { $arrayElemAt: ['$subCategoryDetails._id', 0] },
  //                 name: { $arrayElemAt: ['$subCategoryDetails.name', 0] },
  //               },
  //               else: {
  //                 _id: '$subCategory', // Keep the original ID
  //                 name: 'Uncategorized',
  //               },
  //             },
  //           },
  //           averageRating: 1,
  //           price: 1,
  //           ratingsAverage: 1,
  //           ratingsQuantity: 1,
  //           relevance: 1,
  //           minPrice: 1,
  //           maxPrice: 1,
  //           slug: 1,
  //           createdAt: 1,
  //           updatedAt: 1,
  //         },
  //       },
  //     ];

  //     // Get products and total count
  //     const products = await Product.aggregate(aggregationPipeline);

  //     // Get total count for pagination
  //     const totalCount = await Product.countDocuments(searchQuery);
  //     const totalPages = Math.ceil(totalCount / limitNum);

  //     // Prepare response
  //     const response = {
  //       success: true,
  //       count: products.length,
  //       totalCount,
  //       pagination: {
  //         current: pageNum,
  //         pages: totalPages,
  //         hasNext: pageNum < totalPages,
  //         hasPrev: pageNum > 1,
  //       },
  //       data: products,
  //     };

  //     res.status(200).json(response);
  //   } catch (error) {
  //     console.error('Search error:', error);
  //     res.status(500).json({
  //       success: false,
  //       message: 'Server error during search',
  //       error:
  //         process.env.NODE_ENV === 'development'
  //           ? error.message
  //           : 'Internal server error',
  //     });
  //   }
  try {
    const q = req.params.query;

    console.log('Search query:', q);

    if (!q || q.length < 2) {
      return res.json([]);
    }

    // Search in product names, categories, and tags
    const [productResults, categoryResults, tagResults] = await Promise.all([
      // Product name matches
      Product.find({
        name: { $regex: q, $options: 'i' },
        status: 'active',
      })
        .select('name')
        .limit(5),

      // Category matches
      Category.find({
        name: { $regex: q, $options: 'i' },
      })
        .select('name')
        .limit(5),

      //   Tag matches (assuming tags field exists in Product model)
      Product.distinct('slug', {
        tags: { $regex: q, $options: 'i' },
        status: 'active',
      }),
    ]);
    console.log(
      'Search results:',
      productResults,
      categoryResults,
      // tagResults,
    );

    // Combine and format results
    const suggestions = [];

    // Add product names
    productResults.forEach((product) => {
      suggestions.push({
        type: 'product',
        text: product.name,
        url: `/search?q=${encodeURIComponent(product.name)}`,
      });
    });

    // Add category names
    categoryResults.forEach((category) => {
      suggestions.push({
        type: 'category',
        text: category.name,
        url: `/search?category=${encodeURIComponent(category.name)}`,
      });
    });

    // Add tags
    tagResults.forEach((tag) => {
      suggestions.push({
        type: 'tag',
        text: `#${tag}`,
        url: `/search?tag=${encodeURIComponent(tag)}`,
      });
    });

    // Remove duplicates and limit to 10 suggestions
    const uniqueSuggestions = suggestions
      .reduce((acc, current) => {
        const x = acc.find((item) => item.text === current.text);
        if (!x) {
          return acc.concat([current]);
        } else {
          return acc;
        }
      }, [])
      .slice(0, 10);

    res.json(uniqueSuggestions);
  } catch (error) {
    console.error('Search suggestion error:', error);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});
// @desc    Get search suggestions using route parameter
// @route   GET /api/products/search/suggestions/:query
// @access  Public
exports.getSearchSuggestions = catchAsync(async (req, res) => {
  const { query } = req.params;
  const { limit = 5 } = req.query;

  if (!query || query.length < 2) {
    return res.status(200).json({
      success: true,
      data: [],
    });
  }

  // Decode the search query from URL parameter
  const searchTerm = decodeURIComponent(query);

  // Search for products matching the query
  const products = await Product.find({
    $or: [
      { name: { $regex: searchTerm, $options: 'i' } },
      { description: { $regex: searchTerm, $options: 'i' } },
      { tags: { $regex: searchTerm, $options: 'i' } },
    ],
    status: 'active',
  })
    .select(
      'name price imageCover parentCategory subCategory averageRating slug',
    )
    .limit(parseInt(limit))
    .sort({ averageRating: -1, createdAt: -1 })
    .populate('parentCategory', 'name')
    .populate('subCategory', 'name');

  res.status(200).json({
    success: true,
    data: products,
  });
});
