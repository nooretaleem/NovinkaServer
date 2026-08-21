// src/routes/sitemap.routes.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PROD_SITE_URL = 'https://novinkaconstructions.netlify.app';

/**
 * Escapes XML special characters safely
 */
function escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * GET /sitemap.xml & GET /api/sitemap.xml
 * Dynamic XML sitemap generator fetching published blogs from database
 */
router.get('/', async (req, res) => {
    try {
        // Query only published blogs
        const publishedBlogs = await prisma.blog.findMany({
            where: { isPublished: true },
            select: {
                slug: true,
                updatedAt: true,
                publishedAt: true,
                createdAt: true
            },
            orderBy: { publishedAt: 'desc' }
        });

        // Set XML content type & public cache control
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');

        const urlsAdded = new Set();

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        // 1. Static Public Pages (Homepage Canonical + Core Navigation Pages)
        const staticPages = [
            '/',
            '/pages/about.html',
            '/pages/services.html',
            '/pages/industries.html',
            '/pages/portfolio.html',
            '/pages/wadanza.html',
            '/pages/blog.html',
            '/pages/contact.html'
        ];

        for (const path of staticPages) {
            const fullUrl = `${PROD_SITE_URL}${path}`;
            if (!urlsAdded.has(fullUrl)) {
                urlsAdded.add(fullUrl);
                xml += `  <url>\n    <loc>${escapeXml(fullUrl)}</loc>\n  </url>\n`;
            }
        }

        // 2. Published Blog Posts
        for (const blog of publishedBlogs) {
            if (!blog.slug || blog.slug.trim() === '') continue;

            const blogUrl = `${PROD_SITE_URL}/pages/blog-post.html?slug=${encodeURIComponent(blog.slug)}`;

            if (!urlsAdded.has(blogUrl)) {
                urlsAdded.add(blogUrl);

                const lastmodDate = blog.updatedAt || blog.publishedAt || blog.createdAt;
                const lastmodIso = lastmodDate ? new Date(lastmodDate).toISOString() : null;

                xml += `  <url>\n    <loc>${escapeXml(blogUrl)}</loc>\n`;
                if (lastmodIso) {
                    xml += `    <lastmod>${lastmodIso}</lastmod>\n`;
                }
                xml += `  </url>\n`;
            }
        }

        xml += '</urlset>';

        res.status(200).send(xml);
    } catch (error) {
        console.error('Failed to generate sitemap:', error);
        res.status(500).setHeader('Content-Type', 'application/json').json({
            status: 'error',
            message: 'Failed to generate sitemap'
        });
    }
});

module.exports = router;
