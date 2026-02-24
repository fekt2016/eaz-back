const Product = require('../../models/product/productModel');
const Category = require('../../models/category/categoryModel');
const Seller = require('../../models/user/sellerModel');
const catchAsync = require('../../utils/helpers/catchAsync');
const logger = require('../../utils/logger');

/**
 * Generates a dynamic XML sitemap for search engines
 * Includes: static pages, active products, active categories, and verified sellers
 */
exports.getSitemap = catchAsync(async (req, res, next) => {
    const baseUrl = 'https://saiisai.com';

    // 1. Define Static Pages (Common across the app)
    const staticPages = [
        { path: '', priority: '1.0', changefreq: 'daily' },
        { path: '/about', priority: '0.8', changefreq: 'monthly' },
        { path: '/contact', priority: '0.8', changefreq: 'monthly' },
        { path: '/partner', priority: '0.9', changefreq: 'weekly' },
        { path: '/help', priority: '0.7', changefreq: 'weekly' },
        { path: '/categories', priority: '0.9', changefreq: 'daily' },
        { path: '/sellers', priority: '0.8', changefreq: 'daily' },
        { path: '/offers', priority: '0.9', changefreq: 'daily' },
        { path: '/deals', priority: '0.9', changefreq: 'daily' },
        { path: '/new-arrivals', priority: '0.9', changefreq: 'daily' },
        { path: '/best-sellers', priority: '0.9', changefreq: 'daily' },
        { path: '/terms', priority: '0.5', changefreq: 'monthly' },
        { path: '/privacy', priority: '0.5', changefreq: 'monthly' },
        { path: '/refund-policy', priority: '0.5', changefreq: 'monthly' },
        { path: '/shipping-policy', priority: '0.5', changefreq: 'monthly' },
    ];

    // 2. Fetch Dynamic Content from Database
    // Only include active and approved items
    const products = await Product.find({
        status: 'active',
        moderationStatus: 'approved'
    }).select('slug updatedAt').lean();

    const categories = await Category.find({
        status: 'active'
    }).select('slug updatedAt').lean();

    const sellers = await Seller.find({
        verificationStatus: 'verified',
        status: 'active'
    }).select('_id updatedAt').lean();

    // 3. Build XML String
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Add Static Pages
    staticPages.forEach(page => {
        xml += '  <url>\n';
        xml += `    <loc>${baseUrl}${page.path}</loc>\n`;
        xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
        xml += `    <priority>${page.priority}</priority>\n`;
        xml += '  </url>\n';
    });

    // Add Dynamic Categories
    categories.forEach(category => {
        const lastMod = category.updatedAt ? category.updatedAt.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        xml += '  <url>\n';
        xml += `    <loc>${baseUrl}/categories/${category.slug || category._id}</loc>\n`;
        xml += `    <lastmod>${lastMod}</lastmod>\n`;
        xml += '    <changefreq>weekly</changefreq>\n';
        xml += '    <priority>0.8</priority>\n';
        xml += '  </url>\n';
    });

    // Add Dynamic Products
    products.forEach(product => {
        const lastMod = product.updatedAt ? product.updatedAt.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        xml += '  <url>\n';
        // Use /products/ matching common routing pattern
        xml += `    <loc>${baseUrl}/products/${product._id}</loc>\n`;
        xml += `    <lastmod>${lastMod}</lastmod>\n`;
        xml += '    <changefreq>weekly</changefreq>\n';
        xml += '    <priority>0.7</priority>\n';
        xml += '  </url>\n';
    });

    // Add Dynamic Sellers
    sellers.forEach(seller => {
        const lastMod = seller.updatedAt ? seller.updatedAt.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        xml += '  <url>\n';
        xml += `    <loc>${baseUrl}/sellers/${seller._id}</loc>\n`;
        xml += `    <lastmod>${lastMod}</lastmod>\n`;
        xml += '    <changefreq>weekly</changefreq>\n';
        xml += '    <priority>0.6</priority>\n';
        xml += '  </url>\n';
    });

    xml += '</urlset>';

    // 4. Send Response
    logger.info(`[Sitemap] Generated sitemap with ${staticPages.length + products.length + categories.length + sellers.length} links`);
    res.header('Content-Type', 'application/xml');
    res.status(200).send(xml);
});
