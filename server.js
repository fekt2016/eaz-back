const mongoose = require('mongoose');
const app = require('./app');
const dotenv = require('dotenv');
dotenv.config({ path: './config.env' });

// const commonWords = new Set([
//   'the',
//   'and',
//   'for',
//   'with',
//   'this',
//   'that',
//   'these',
//   'those',
//   'from',
//   'your',
//   'have',
//   'has',
//   'had',
//   'was',
//   'were',
//   'are',
//   'is',
//   'product',
//   'item',
//   'new',
//   'quality',
//   'high',
//   'premium',
//   'a',
//   'an',
//   'in',
//   'on',
//   'at',
//   'to',
//   'of',
//   'by',
//   'as',
//   'it',
//   'its',
//   'or',
//   'but',
//   'not',
//   'be',
//   'been',
//   'being',
//   'do',
//   'does',
//   'did',
//   'done',
//   'can',
//   'could',
//   'will',
//   'would',
//   'shall',
//   'should',
//   'may',
//   'might',
//   'must',
// ]);

// // Function to generate tags for a product
// async function generateTagsForProduct(product) {
//   const tags = new Set();

//   // Add brand
//   if (product.brand) {
//     tags.add(product.brand.toLowerCase().trim());
//   }

//   // Add category names
//   try {
//     // Populate categories if they're just IDs
//     let parentCategoryName = '';
//     let subCategoryName = '';

//     if (
//       typeof product.parentCategory === 'object' &&
//       product.parentCategory.name
//     ) {
//       parentCategoryName = product.parentCategory.name;
//     } else {
//       const parentCat = await Category.findById(product.parentCategory);
//       parentCategoryName = parentCat ? parentCat.name : '';
//     }

//     if (typeof product.subCategory === 'object' && product.subCategory.name) {
//       subCategoryName = product.subCategory.name;
//     } else {
//       const subCat = await Category.findById(product.subCategory);
//       subCategoryName = subCat ? subCat.name : '';
//     }

//     if (parentCategoryName) {
//       tags.add(parentCategoryName.toLowerCase().trim());
//     }

//     if (subCategoryName) {
//       tags.add(subCategoryName.toLowerCase().trim());
//     }

//     // Add brand + category combinations
//     if (product.brand && parentCategoryName) {
//       tags.add(
//         `${product.brand.toLowerCase().trim()}-${parentCategoryName.toLowerCase().trim()}`,
//       );
//     }
//   } catch (error) {
//     console.error(
//       `Error processing categories for product ${product._id}:`,
//       error,
//     );
//   }

//   // Add material tags
//   if (product.specifications && product.specifications.material) {
//     product.specifications.material.forEach((material) => {
//       if (material && material.value) {
//         const materialValue = material.value.toLowerCase().trim();
//         tags.add(materialValue);

//         // Add material + category combinations
//         if (parentCategoryName) {
//           tags.add(
//             `${materialValue}-${parentCategoryName.toLowerCase().trim()}`,
//           );
//         }

//         // Add brand + material combinations
//         if (product.brand) {
//           tags.add(`${product.brand.toLowerCase().trim()}-${materialValue}`);
//         }
//       }
//     });
//   }

//   // Add color tags
//   if (product.specifications && product.specifications.color) {
//     product.specifications.color.forEach((color) => {
//       if (color && color.name) {
//         const colorName = color.name.toLowerCase().trim();
//         tags.add(colorName);

//         // Add color + category combinations
//         if (parentCategoryName) {
//           tags.add(`${colorName}-${parentCategoryName.toLowerCase().trim()}`);
//         }

//         // Add brand + color combinations
//         if (product.brand) {
//           tags.add(`${product.brand.toLowerCase().trim()}-${colorName}`);
//         }
//       }
//     });
//   }

//   // Add keywords from name
//   if (product.name) {
//     const nameWords = product.name.toLowerCase().split(/\s+/);
//     nameWords.forEach((word) => {
//       const cleanWord = word.replace(/[^a-z0-9]/g, '');
//       if (cleanWord.length > 2 && !commonWords.has(cleanWord)) {
//         tags.add(cleanWord);
//       }
//     });
//   }

//   // Add condition tag
//   if (product.condition) {
//     tags.add(product.condition);
//   }

//   // Add tags from variant attributes
//   if (product.variants && product.variants.length > 0) {
//     product.variants.forEach((variant) => {
//       if (variant.attributes && variant.attributes.length > 0) {
//         variant.attributes.forEach((attr) => {
//           if (attr.key && attr.value) {
//             const key = attr.key.toLowerCase().trim();
//             const value = attr.value.toLowerCase().trim();

//             tags.add(value);
//             tags.add(`${key}-${value}`);

//             // Add brand + attribute combinations
//             if (product.brand) {
//               tags.add(`${product.brand.toLowerCase().trim()}-${value}`);
//             }
//           }
//         });
//       }
//     });
//   }

//   // Convert to array and limit to 20 tags
//   return Array.from(tags)
//     .filter((tag) => tag && tag.length > 0)
//     .slice(0, 20);
// }

// // Main function to update all products with tags
// async function addTagsToAllProducts() {
//   try {
//     // Connect to MongoDB

//     // Get all products with necessary fields populated
//     const products = await Product.find()
//       .populate('parentCategory', 'name')
//       .populate('subCategory', 'name');

//     console.log(`Found ${products.length} products to process`);

//     let updatedCount = 0;
//     let errorCount = 0;

//     // Process each product
//     for (const product of products) {
//       try {
//         // Generate tags for the product
//         const tags = await generateTagsForProduct(product);

//         // Update the product with the generated tags
//         await Product.findByIdAndUpdate(product._id, { tags });

//         updatedCount++;

//         // Log progress every 100 products
//         if (updatedCount % 100 === 0) {
//           console.log(`Updated ${updatedCount} products so far...`);
//         }
//       } catch (error) {
//         console.error(`Error updating product ${product._id}:`, error);
//         errorCount++;
//       }
//     }

//     console.log(`\nProcess completed!`);
//     console.log(`Successfully updated: ${updatedCount} products`);
//     console.log(`Errors: ${errorCount} products`);
//   } catch (error) {
//     console.error('Error in main function:', error);
//   } finally {
//     // Close the database connection
//   }
// }

const mongodb = process.env.MONGO_URL.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD,
);

// Database connection
mongoose
  .connect(mongodb)
  .then(async () => {
    console.log('Connected to MongoDB');

    // Import models AFTER connection is established
    // const User = require('./Models/userModel');
    // const Permission = require('./Models/permissionModel');

    // Run permissions fix
    // await fixPermissions(User, Permission);
    // await addTagsToAllProducts();

    // Start server AFTER migrations
    const port = process.env.PORT || 4000;

    const server = app.listen(port, () => {
      console.log(`Server running on port ${port}`);
      console.log(`Server running on port ${port}`);
      console.log(`Server running on port ${port}`);
    });

    // Error handling
    process.on('unhandledRejection', (err) => {
      console.error('UNHANDLED REJECTION! 🔥 Shutting down');
      console.error(err.name, err.message);
      server.close(() => {
        process.exit(1);
      });
    });

    process.on('uncaughtException', (err) => {
      console.error('UNCAUGHT EXCEPTION! 🔥 Shutting down');
      console.error(err.name, err.message);
      server.close(() => {
        process.exit(1);
      });
    });
  })
  .catch((error) => {
    console.error('Error connecting to MongoDB:', error);
    process.exit(1);
  });

// Define fixPermissions function with parameters
// async function fixPermissions(User, Permission) {
//   try {
//     console.log('Starting permission fix...');

//     // Find users with duplicate permissions
//     const users = await User.aggregate([
//       {
//         $lookup: {
//           from: 'permissions',
//           localField: '_id',
//           foreignField: 'user',
//           as: 'perms',
//         },
//       },
//       {
//         $match: {
//           'perms.1': { $exists: true }, // Users with >1 permission
//         },
//       },
//     ]);

//     console.log(`Found ${users.length} users with duplicate permissions`);

//     for (const user of users) {
//       try {
//         // Keep first permission, delete others
//         const [keep, ...duplicates] = user.perms;

//         // Update user reference
//         await User.findByIdAndUpdate(user._id, { permissions: keep._id });

//         // Delete duplicates
//         await Permission.deleteMany({
//           _id: { $in: duplicates.map((d) => d._id) },
//         });

//         console.log(`Fixed permissions for user ${user._id}`);
//       } catch (innerError) {
//         console.error(`Error fixing user ${user._id}:`, innerError.message);
//       }
//     }

//     console.log('Permission fix completed successfully');
//   } catch (err) {
//     console.error('Permission fix failed:', err);
//     throw err; // Rethrow to exit process
//   }
// }
