// src/routes/blog.routes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const uploadToCloudinary = require('../utils/cloudinary-upload');
const deleteFromCloudinary = require('../utils/cloudinary-delete');
const prisma = require('../config/prisma');
const { createNotification } = require('./notification.routes');

/**
 * Generate a URL-friendly slug from a string
 */
function generateSlug(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Reusable helper to dispatch blog notifications to all active staff/managers/admins
 */
async function notifyBlogEvent(blogId, title, message) {
    try {
        const users = await prisma.user.findMany({
            where: {
                isActive: true,
                role: { in: ['ADMIN', 'MANAGER', 'STAFF'] }
            },
            select: { id: true }
        });

        for (const user of users) {
            await createNotification(
                user.id,
                'BLOG',
                title,
                message,
                '📝',
                `/blogs/${blogId}`
            );
        }
    } catch (err) {
        console.error('Failed to dispatch blog notification:', err);
    }
}

// ============================================
// GET ALL BLOGS
// ============================================
router.get('/', async (req, res) => {
    try {
        const { status, category, search } = req.query;

        const where = {};

        if (status === 'published') {
            where.isPublished = true;
        } else if (status === 'draft') {
            where.isPublished = false;
        }

        if (category && category !== 'all') {
            where.categories = {
                contains: category
            };
        }

        if (search) {
            where.OR = [
                { title: { contains: search } },
                { excerpt: { contains: search } }
            ];
        }

        const blogs = await prisma.blog.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });

        const parsedBlogs = blogs.map(blog => {
            let categories = [];
            try {
                if (blog.categories) {
                    categories = typeof blog.categories === 'string' ? JSON.parse(blog.categories) : blog.categories;
                }
            } catch (e) {
                categories = [];
            }

            return {
                ...blog,
                categories
            };
        });

        res.status(200).json({
            status: 'success',
            data: {
                blogs: parsedBlogs,
                total: parsedBlogs.length
            }
        });
    } catch (error) {
        console.error('Failed to fetch blogs:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch blogs'
        });
    }
});

// ============================================
// GET ALL BLOG CATEGORIES
// ============================================
router.get('/categories/all', async (req, res) => {
    try {
        const blogs = await prisma.blog.findMany({
            select: { categories: true }
        });

        const categorySet = new Set();
        blogs.forEach(blog => {
            if (blog.categories) {
                try {
                    const cats = typeof blog.categories === 'string' ? JSON.parse(blog.categories) : blog.categories;
                    if (Array.isArray(cats)) {
                        cats.forEach(cat => categorySet.add(cat));
                    }
                } catch (e) { }
            }
        });

        res.status(200).json({
            status: 'success',
            data: { categories: Array.from(categorySet) }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch categories'
        });
    }
});

// ============================================
// GET SINGLE BLOG BY SLUG (Public Route - Increments View Count)
// ============================================
router.get('/slug/:slug', async (req, res) => {
    try {
        const { slug } = req.params;

        const blog = await prisma.blog.findUnique({
            where: { slug }
        });

        if (!blog || !blog.isPublished) {
            return res.status(404).json({
                status: 'error',
                message: 'Blog not found'
            });
        }

        // Increment view count atomically for published blog
        const updatedBlog = await prisma.blog.update({
            where: { id: blog.id },
            data: {
                viewCount: { increment: 1 }
            }
        });

        let categories = [];
        try {
            if (updatedBlog.categories) {
                categories = typeof updatedBlog.categories === 'string' ? JSON.parse(updatedBlog.categories) : updatedBlog.categories;
            }
        } catch (e) {
            categories = [];
        }

        const parsedBlog = {
            ...updatedBlog,
            categories
        };

        res.status(200).json({
            status: 'success',
            data: { blog: parsedBlog }
        });
    } catch (error) {
        console.error('Failed to fetch blog by slug:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch blog'
        });
    }
});

// ============================================
// GET SINGLE BLOG BY ID
// ============================================
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const blog = await prisma.blog.findUnique({
            where: { id }
        });

        if (!blog) {
            return res.status(404).json({
                status: 'error',
                message: 'Blog not found'
            });
        }

        let categories = [];
        try {
            if (blog.categories) {
                categories = typeof blog.categories === 'string' ? JSON.parse(blog.categories) : blog.categories;
            }
        } catch (e) {
            categories = [];
        }

        const parsedBlog = {
            ...blog,
            categories
        };

        res.status(200).json({
            status: 'success',
            data: { blog: parsedBlog }
        });
    } catch (error) {
        console.error('Failed to fetch blog:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch blog'
        });
    }
});

// ============================================
// CREATE BLOG (Multipart File Upload)
// ============================================
router.post('/', authMiddleware, upload.single('featuredImage'), async (req, res) => {
    try {
        const {
            title,
            excerpt,
            content,
            categories,
            seoTitle,
            seoDescription,
            isPublished
        } = req.body;

        if (!title || !content) {
            return res.status(400).json({
                status: 'error',
                message: 'Title and content are required'
            });
        }

        let featuredImage = null;
        let featuredImagePublicId = null;

        // Upload image file using reusable Cloudinary helper
        if (req.file) {
            const result = await uploadToCloudinary(req.file, 'novinka/blogs');
            featuredImage = result.secure_url;
            featuredImagePublicId = result.public_id;
        }

        let slug = generateSlug(title);
        let existingBlog = await prisma.blog.findUnique({
            where: { slug }
        });

        if (existingBlog) {
            slug = `${slug}-${Date.now().toString().slice(-4)}`;
        }

        let serializedCategories = '[]';
        if (categories) {
            serializedCategories = typeof categories === 'string' ? categories : JSON.stringify(categories);
        }

        const authorId = req.user ? req.user.id : 'system';
        const isPublishedBool = isPublished === 'true' || isPublished === true;

        const blog = await prisma.blog.create({
            data: {
                title,
                slug,
                excerpt: excerpt || null,
                content,
                featuredImage,
                featuredImagePublicId,
                categories: serializedCategories,
                seoTitle: seoTitle || null,
                seoDescription: seoDescription || null,
                viewCount: 0,
                isPublished: isPublishedBool,
                publishedAt: isPublishedBool ? new Date() : null,
                authorId
            }
        });

        // Trigger automatic notification for blog creation
        await notifyBlogEvent(blog.id, 'New Blog Post', `"${blog.title}" has been created.`);

        let parsedCategories = [];
        try {
            if (blog.categories) {
                parsedCategories = typeof blog.categories === 'string' ? JSON.parse(blog.categories) : blog.categories;
            }
        } catch (e) { }

        res.status(201).json({
            status: 'success',
            data: { blog: { ...blog, categories: parsedCategories } },
            message: 'Blog created successfully'
        });
    } catch (error) {
        console.error('Failed to create blog:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create blog'
        });
    }
});

// ============================================
// UPDATE BLOG (Multipart File Upload)
// ============================================
router.put('/:id', authMiddleware, upload.single('featuredImage'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            title,
            excerpt,
            content,
            categories,
            seoTitle,
            seoDescription,
            isPublished
        } = req.body;

        const existingBlog = await prisma.blog.findUnique({
            where: { id }
        });

        if (!existingBlog) {
            return res.status(404).json({
                status: 'error',
                message: 'Blog not found'
            });
        }

        let featuredImage = existingBlog.featuredImage;
        let featuredImagePublicId = existingBlog.featuredImagePublicId;

        // Upload new image file using reusable Cloudinary helper
        if (req.file) {
            if (existingBlog.featuredImagePublicId) {
                try {
                    await deleteFromCloudinary(existingBlog.featuredImagePublicId);
                } catch (destroyErr) {
                    console.error('Failed to delete previous Cloudinary image:', destroyErr);
                }
            }

            const result = await uploadToCloudinary(req.file, 'novinka/blogs');
            featuredImage = result.secure_url;
            featuredImagePublicId = result.public_id;
        }

        let slug = existingBlog.slug;
        if (title && title !== existingBlog.title) {
            slug = generateSlug(title);
            const conflictingBlog = await prisma.blog.findFirst({
                where: {
                    slug,
                    NOT: { id }
                }
            });
            if (conflictingBlog) {
                slug = `${slug}-${Date.now().toString().slice(-4)}`;
            }
        }

        let serializedCategories = existingBlog.categories;
        if (categories !== undefined) {
            serializedCategories = typeof categories === 'string' ? categories : JSON.stringify(categories);
        }

        const isPublishedBool = isPublished !== undefined
            ? (isPublished === 'true' || isPublished === true)
            : existingBlog.isPublished;

        const publishedAt = isPublishedBool && !existingBlog.isPublished
            ? new Date()
            : existingBlog.publishedAt;

        const blog = await prisma.blog.update({
            where: { id },
            data: {
                title: title || existingBlog.title,
                slug,
                excerpt: excerpt !== undefined ? excerpt : existingBlog.excerpt,
                content: content || existingBlog.content,
                featuredImage,
                featuredImagePublicId,
                categories: serializedCategories,
                seoTitle: seoTitle !== undefined ? seoTitle : existingBlog.seoTitle,
                seoDescription: seoDescription !== undefined ? seoDescription : existingBlog.seoDescription,
                isPublished: isPublishedBool,
                publishedAt
            }
        });

        // Trigger automatic notification for blog update
        await notifyBlogEvent(blog.id, 'Blog Post Updated', `"${blog.title}" has been updated.`);

        let parsedCategories = [];
        try {
            if (blog.categories) {
                parsedCategories = typeof blog.categories === 'string' ? JSON.parse(blog.categories) : blog.categories;
            }
        } catch (e) { }

        res.status(200).json({
            status: 'success',
            data: { blog: { ...blog, categories: parsedCategories } },
            message: 'Blog updated successfully'
        });
    } catch (error) {
        console.error('Failed to update blog:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update blog'
        });
    }
});

// ============================================
// TOGGLE PUBLISH STATUS
// ============================================
router.patch('/:id/publish', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { isPublished } = req.body;

        const blog = await prisma.blog.findUnique({
            where: { id }
        });

        if (!blog) {
            return res.status(404).json({
                status: 'error',
                message: 'Blog not found'
            });
        }

        const isPublishedBool = isPublished === true || isPublished === 'true';

        const updatedBlog = await prisma.blog.update({
            where: { id },
            data: {
                isPublished: isPublishedBool,
                publishedAt: isPublishedBool ? new Date() : null
            }
        });

        // Trigger automatic notification for publish/unpublish
        const statusTitle = isPublishedBool ? 'Blog Published' : 'Blog Unpublished';
        const statusMessage = isPublishedBool
            ? `"${updatedBlog.title}" has been published.`
            : `"${updatedBlog.title}" has been unpublished.`;
        await notifyBlogEvent(updatedBlog.id, statusTitle, statusMessage);

        res.status(200).json({
            status: 'success',
            data: { blog: updatedBlog },
            message: isPublishedBool ? 'Blog published successfully' : 'Blog unpublished'
        });
    } catch (error) {
        console.error('Failed to toggle blog publish status:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update blog status'
        });
    }
});

// ============================================
// DELETE BLOG WITH CLOUDINARY CLEANUP
// ============================================
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const blog = await prisma.blog.findUnique({
            where: { id }
        });

        if (!blog) {
            return res.status(404).json({
                status: 'error',
                message: 'Blog not found'
            });
        }

        // Trigger automatic notification before deletion
        await notifyBlogEvent(blog.id, 'Blog Post Deleted', `"${blog.title}" has been deleted.`);

        if (blog.featuredImagePublicId) {
            try {
                await deleteFromCloudinary(blog.featuredImagePublicId);
            } catch (destroyErr) {
                console.error('Failed to delete Cloudinary image:', destroyErr);
            }
        }

        await prisma.blog.delete({
            where: { id }
        });

        res.status(200).json({
            status: 'success',
            message: 'Blog deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete blog:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to delete blog'
        });
    }
});

module.exports = router;