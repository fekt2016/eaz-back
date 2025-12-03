# Seller Products Seeder

## Overview

This seeder script automatically generates **10 sample products** for each seller in your database. The products include:

- ✅ **Mix of new and used products** (70% new, 30% used)
- ✅ **Realistic product data** with proper variants, attributes, and pricing
- ✅ **Category-aware** - Uses existing categories from your database
- ✅ **Safe** - Does NOT delete or modify existing products
- ✅ **Complete** - Includes images, descriptions, ratings, stock, etc.

## Features

### Product Generation
- **10 products per seller** automatically
- **Realistic names, brands, and descriptions**
- **Variants with attributes** (Color, Size, Storage, etc.)
- **Proper pricing** (used products are 30-50% cheaper)
- **Stock management** (5-200 units per variant)
- **Ratings and reviews** (3.0-5.0 stars)
- **Placeholder images** (via.placeholder.com)

### Used Products
- **30% of products are marked as "used"**
- **Lower prices** (30-50% discount from new)
- **Slightly lower ratings** (3.0-4.5 vs 3.5-5.0)
- **Condition field** properly set to `'used'`

### Category Support
The seeder intelligently maps your categories to product templates:
- **Electronics** → Phones, laptops, accessories
- **Fashion** → Clothing, shoes, accessories
- **Home** → Kitchen, furniture, decor
- **Beauty** → Cosmetics, skincare
- **Sports** → Fitness equipment, gear

## Prerequisites

Before running the seeder:

1. ✅ **Sellers must exist** in the database
2. ✅ **Categories must exist** (parent categories with subcategories)
3. ✅ **Database connection** must be configured in `.env`

## Usage

### Run the Seeder

```bash
npm run seed:seller-products
```

### What It Does

1. **Connects to MongoDB** using your `.env` configuration
2. **Fetches all sellers** from the database
3. **Fetches all active categories** (parent + subcategories)
4. **Generates 10 products** for each seller:
   - Mix of new and used products
   - Realistic data with variants
   - Proper category assignment
   - Images, descriptions, ratings
5. **Updates seller product counts** automatically
6. **Logs progress** for each seller

### Example Output

```
✅ Connected to MongoDB

📦 Found 5 sellers
📂 Found 8 parent categories
📂 Found 24 subcategories
📂 Using 24 category pairs

🛍️  Processing seller: TechStore (seller@example.com)
   ✅ Added 10 products (7 new, 3 used)

🛍️  Processing seller: FashionHub (fashion@example.com)
   ✅ Added 10 products (6 new, 4 used)

...

============================================================
✅ SEEDING COMPLETE
============================================================
Total sellers processed: 5
Total products generated: 50
Average products per seller: 10.0
============================================================
```

## Product Data Generated

Each product includes:

### Core Fields
- `name` - Product name with brand
- `description` - Full product description
- `shortDescription` - 160 char summary
- `imageCover` - Main product image
- `images` - 3-5 additional images
- `brand` - Random brand from category
- `condition` - 'new' or 'used'

### Categories
- `parentCategory` - Main category (required)
- `subCategory` - Subcategory (required)
- `categoryPath` - Auto-generated path

### Variants (1-4 per product)
- `attributes` - Color, Size, Storage, etc.
- `price` - Variant price (20-500 GHS)
- `originalPrice` - Original price (for discounts)
- `stock` - Stock quantity (5-200)
- `sku` - Auto-generated SKU
- `weight` & `dimensions` - Shipping info

### Ratings & Stats
- `ratingsAverage` - 3.0-5.0 stars
- `ratingsQuantity` - 0-100 reviews
- `ratingDistribution` - Breakdown by star
- `totalSold` - 0-50 units
- `totalViews` - 0-500 views

### Additional
- `tags` - Auto-generated from name/brand
- `keywords` - SEO keywords
- `specifications` - Material, color, dimensions
- `shipping` - Weight, dimensions, free shipping flag
- `status` - 'active'

## Used Products Details

Used products have:
- **Condition**: `'used'`
- **Price**: 30-50% lower than new
- **Ratings**: Slightly lower (3.0-4.5 vs 3.5-5.0)
- **Description**: Includes "This is a pre-owned item in good condition."
- **Name**: Includes "(Used)" suffix

## Safety Features

✅ **No Deletion** - Never deletes existing products  
✅ **No Updates** - Never modifies existing products  
✅ **Error Handling** - Continues if one seller fails  
✅ **Validation** - Uses your existing Product model validation  
✅ **Idempotent** - Can run multiple times safely  

## Troubleshooting

### "No sellers found"
- Create sellers first using your seller registration flow
- Check that sellers exist in the database

### "No categories found"
- Create parent categories first
- Create subcategories linked to parents
- Ensure categories have `status: 'active'`

### "No subcategories found"
- Create subcategories with `parentCategory` set
- Ensure subcategories have `status: 'active'`

### Connection Errors
- Check `.env` file has `MONGO_URL` or `DATABASE` set
- Verify `DATABASE_PASSWORD` is correct
- Ensure MongoDB is running

### Validation Errors
- Check Product model requirements
- Ensure all required fields are generated
- Review error messages for specific field issues

## Customization

To customize product generation, edit:
- `PRODUCT_TEMPLATES` - Product names, brands, descriptions
- `CONDITIONS` - Distribution of new vs used
- `generateFakeProductData()` - Product data structure
- `generateVariants()` - Variant generation logic

## Notes

- Products use placeholder images from `via.placeholder.com`
- SKUs are auto-generated based on seller ID
- Prices are in GHS (Ghana Cedis)
- All products are set to `status: 'active'`
- Seller product counts are automatically updated

