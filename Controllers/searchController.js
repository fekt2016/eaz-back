const catchAsync = require('../utils/catchAsync');
const { validationResult } = require('express-validator');
// @desc    Search products using route parameter
// @route   GET /api/products/search/:query
// @access  Public
const Product = require('../Models/productModel');
const Category = require('../Models/categoryModel'); // Make sure to import Category
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

exports.searchProducts = catchAsync(async (req, res, next) => {
  try {
    const q = req.params.query;

    if (!q || q.length < 2) {
      return res.json([]);
    }

    const [productResults, categoryResults, tagResults, brandResults] =
      await Promise.all([
        // Product name matches
        Product.find({
          name: { $regex: q, $options: 'i' },
          status: 'active',
        })
          .select('name')
          .limit(5),

        // Categories (parent + sub)
        Category.find({
          _id: {
            $in: [
              ...(await Product.distinct('parentCategory')),
              ...(await Product.distinct('subCategory')),
            ],
          },
          name: { $regex: q, $options: 'i' },
        })
          .select('name')
          .limit(10),
        // Brands (distinct values from products)
        Product.distinct('brand', { status: 'active' }),

        // Tags
        Product.distinct('tags', {
          tags: { $regex: q, $options: 'i' },
          status: 'active',
        }),
      ]);

    const suggestions = [];

    // Products
    productResults.forEach((product) => {
      suggestions.push({
        type: 'product',
        text: product.name,
        url: `/search?type=product&q=${encodeURIComponent(product.name)}`,
      });
    });

    // Categories
    categoryResults.forEach((category) => {
      suggestions.push({
        type: 'category',
        text: category.name,
        url: `/search?type=category&category=${encodeURIComponent(category.name)}`,
      });
    });
    const filteredBrands = brandResults.filter(
      (b) => typeof b === 'string' && b.toLowerCase().includes(q.toLowerCase()),
    );

    // Brands
    filteredBrands.forEach((brand) => {
      const brandUrl = `/search?type=brand&brand=${encodeURIComponent(brand)}`;
      const brandText = brand.replace(/^\w/, (c) => c.toUpperCase());
      const brandType = 'brand';

      suggestions.push({
        type: brandType,
        text: brandText,
        url: brandUrl,
      });
      // console.log('suggestions', suggestions);
    });

    // Tags
    tagResults
      .filter((tag) => tag && tag.toLowerCase().includes(q.toLowerCase())) // ✅ double-check relation
      .forEach((tag) => {
        console.log('matched tag:', tag);
        suggestions.push({
          type: 'tag',
          text: `${tag}`,
          url: `/search?type=tag&tag=${encodeURIComponent(tag)}`,
        });
      });

    // Deduplicate + limit
    const uniqueSuggestions = suggestions
      .reduce((acc, current) => {
        const exists = acc.find(
          (item) => item.text === current.text && item.type === current.type,
        );
        if (!exists) acc.push(current);
        return acc;
      }, [])
      .slice(0, 10);

    res.status(200).json(uniqueSuggestions);
  } catch (error) {
    console.error('Search suggestion error:', error);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

exports.searchProductsResults = catchAsync(async (req, res, next) => {
  console.log('req.query', req.query);
  const { type, q } = req.query;

  let products = [];
  // if()

  if (type === 'product') {
    // Search by product name (partial match, case-insensitive)
    products = await Product.find({
      name: { $regex: q, $options: 'i' },
      status: 'active',
    });
  } else if (type === 'category') {
    console.log('category', type);
    // Search by category (could be parentCategory or subCategory)
    const categoryDoc = await Category.findOne({
      name: { $regex: `^${q.trim()}$`, $options: 'i' },
    });

    if (categoryDoc) {
      if (!categoryDoc.parentCategory) {
        // 👉 Parent category
        products = await Product.find({
          parentCategory: categoryDoc._id,
          status: 'active',
        }).populate('parentCategory subCategory');
      } else {
        // 👉 Subcategory
        products = await Product.find({
          subCategory: categoryDoc._id,
          status: 'active',
        }).populate('parentCategory subCategory');
      }
    }
  } else if (type === 'brand') {
    console.log('brand', type);
    // Search by brand
    products = await Product.find({
      brand: { $regex: q, $options: 'i' }, // partial match
      status: 'active',
    });
    console.log('products', products);
  } else if (type === 'tag') {
    // Search by tag
    products = await Product.find({
      tags: { $in: [q.toLowerCase()] }, // tags are stored lowercase
      status: 'active',
    });
  } else if (q) {
    // Fallback: free-text search across product names
    products = await Product.find({
      name: { $regex: q, $options: 'i' },
      status: 'active',
    });
  }

  res.status(200).json({
    success: true,
    results: products.length,
    data: products,
  });
});

// @desc    Get search suggestions using route parameter
// @route   GET /api/products/search/suggestions/:query
// @access  Public
