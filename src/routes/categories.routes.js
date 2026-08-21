// src/routes/categories.routes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const prisma = require('../config/prisma');

// ============================================
// GET ALL CATEGORIES
// ============================================
router.get('/', async (req, res) => {
    try {
        const categories = await prisma.category.findMany({
            orderBy: [
                { displayOrder: 'asc' },
                { createdAt: 'desc' }
            ]
        });

        // Get project count for each category
        const categoriesWithCount = await Promise.all(
            categories.map(async (category) => {
                const projectCount = await prisma.project.count({
                    where: {
                        categoryId: category.id
                    }
                });

                return {
                    ...category,
                    projectCount
                };
            })
        );

        res.status(200).json({
            status: 'success',
            data: { categories: categoriesWithCount }
        });
    } catch (error) {
        console.error('Failed to fetch categories:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch categories'
        });
    }
});

// ============================================
// GET SINGLE CATEGORY
// ============================================
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const category = await prisma.category.findUnique({
            where: { id }
        });

        if (!category) {
            return res.status(404).json({
                status: 'error',
                message: 'Category not found'
            });
        }

        // Get projects in this category
        const projects = await prisma.project.findMany({
            where: {
                categoryId: category.id
            },
            select: {
                id: true,
                title: true,
                location: true,
                coverImage: true,
                isFeatured: true,
                completionDate: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        const projectCount = projects.length;

        res.status(200).json({
            status: 'success',
            data: {
                category: {
                    ...category,
                    projectCount,
                    projects
                }
            }
        });
    } catch (error) {
        console.error('Failed to fetch category:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch category'
        });
    }
});

// ============================================
// CREATE CATEGORY
// ============================================
router.post('/', authMiddleware, async (req, res) => {
    try {
        const {
            name,
            description,
            icon,
            color,
            isFeatured,
            isActive,
            displayOrder
        } = req.body;

        // Check if category with same name exists
        const existingCategory = await prisma.category.findFirst({
            where: {
                name: {
                    equals: name,
                    mode: 'insensitive'
                }
            }
        });

        if (existingCategory) {
            return res.status(400).json({
                status: 'error',
                message: 'A category with this name already exists'
            });
        }

        // Generate slug from name
        const slug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

        const category = await prisma.category.create({
            data: {
                name,
                slug,
                description: description || null,
                icon: icon || '📁',
                color: color || '#0073E6',
                isFeatured: isFeatured === 'true' || isFeatured === true,
                isActive: isActive !== undefined ? (isActive === 'true' || isActive === true) : true,
                displayOrder: displayOrder ? parseInt(displayOrder, 10) : 0
            }
        });

        res.status(201).json({
            status: 'success',
            data: { category },
            message: 'Category created successfully'
        });
    } catch (error) {
        console.error('Failed to create category:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create category'
        });
    }
});

// ============================================
// UPDATE CATEGORY
// ============================================
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name,
            description,
            icon,
            color,
            isFeatured,
            isActive,
            displayOrder
        } = req.body;

        // Check if category exists
        const existingCategory = await prisma.category.findUnique({
            where: { id }
        });

        if (!existingCategory) {
            return res.status(404).json({
                status: 'error',
                message: 'Category not found'
            });
        }

        // Check if another category with same name exists
        if (name && name !== existingCategory.name) {
            const duplicateCategory = await prisma.category.findFirst({
                where: {
                    name: {
                        equals: name,
                        mode: 'insensitive'
                    },
                    NOT: {
                        id: id
                    }
                }
            });

            if (duplicateCategory) {
                return res.status(400).json({
                    status: 'error',
                    message: 'A category with this name already exists'
                });
            }
        }

        // Update slug if name changed
        let slug = existingCategory.slug;
        if (name && name !== existingCategory.name) {
            slug = name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
        }

        const category = await prisma.category.update({
            where: { id },
            data: {
                name: name || existingCategory.name,
                slug,
                description: description !== undefined ? description : existingCategory.description,
                icon: icon || existingCategory.icon,
                color: color || existingCategory.color,
                isFeatured: isFeatured !== undefined ? (isFeatured === 'true' || isFeatured === true) : existingCategory.isFeatured,
                isActive: isActive !== undefined ? (isActive === 'true' || isActive === true) : existingCategory.isActive,
                displayOrder: displayOrder !== undefined ? parseInt(displayOrder, 10) : existingCategory.displayOrder
            }
        });

        res.status(200).json({
            status: 'success',
            data: { category },
            message: 'Category updated successfully'
        });
    } catch (error) {
        console.error('Failed to update category:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update category'
        });
    }
});

// ============================================
// DELETE CATEGORY
// ============================================
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        // Check if category exists
        const category = await prisma.category.findUnique({
            where: { id }
        });

        if (!category) {
            return res.status(404).json({
                status: 'error',
                message: 'Category not found'
            });
        }

        // Check if category has projects
        const projectCount = await prisma.project.count({
            where: {
                categoryId: id
            }
        });

        if (projectCount > 0) {
            // Option 1: Prevent deletion if projects exist
            return res.status(400).json({
                status: 'error',
                message: `Cannot delete category. It is used by ${projectCount} project(s). Please reassign or delete the projects first.`,
                data: { projectCount }
            });

            // Option 2: Alternatively, you can set categoryId to null for all projects
            // await prisma.project.updateMany({
            //     where: { categoryId: id },
            //     data: { categoryId: null }
            // });
        }

        // Delete the category
        await prisma.category.delete({
            where: { id }
        });

        res.status(200).json({
            status: 'success',
            message: 'Category deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete category:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to delete category'
        });
    }
});

// ============================================
// BULK UPDATE CATEGORIES (Order, Featured, etc.)
// ============================================
router.patch('/bulk', authMiddleware, async (req, res) => {
    try {
        const { updates } = req.body;

        if (!updates || !Array.isArray(updates)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid request. Expected array of updates.'
            });
        }

        const results = await Promise.all(
            updates.map(async (update) => {
                const { id, displayOrder, isFeatured, isActive } = update;

                return prisma.category.update({
                    where: { id },
                    data: {
                        ...(displayOrder !== undefined && { displayOrder: parseInt(displayOrder, 10) }),
                        ...(isFeatured !== undefined && { isFeatured: isFeatured === 'true' || isFeatured === true }),
                        ...(isActive !== undefined && { isActive: isActive === 'true' || isActive === true })
                    }
                });
            })
        );

        res.status(200).json({
            status: 'success',
            data: { categories: results },
            message: 'Categories updated successfully'
        });
    } catch (error) {
        console.error('Failed to bulk update categories:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update categories'
        });
    }
});

// ============================================
// GET FEATURED CATEGORIES
// ============================================
router.get('/featured', async (req, res) => {
    try {
        const categories = await prisma.category.findMany({
            where: {
                isFeatured: true,
                isActive: true
            },
            orderBy: {
                displayOrder: 'asc'
            }
        });

        // Get project count for each category
        const categoriesWithCount = await Promise.all(
            categories.map(async (category) => {
                const projectCount = await prisma.project.count({
                    where: {
                        categoryId: category.id
                    }
                });

                return {
                    ...category,
                    projectCount
                };
            })
        );

        res.status(200).json({
            status: 'success',
            data: { categories: categoriesWithCount }
        });
    } catch (error) {
        console.error('Failed to fetch featured categories:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch featured categories'
        });
    }
});

// ============================================
// GET CATEGORY PROJECTS
// ============================================
router.get('/:id/projects', async (req, res) => {
    try {
        const { id } = req.params;

        const category = await prisma.category.findUnique({
            where: { id }
        });

        if (!category) {
            return res.status(404).json({
                status: 'error',
                message: 'Category not found'
            });
        }

        const projects = await prisma.project.findMany({
            where: {
                categoryId: id
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Parse JSON fields
        const parsedProjects = projects.map(project => ({
            ...project,
            gallery: project.gallery ? JSON.parse(project.gallery) : []
        }));

        res.status(200).json({
            status: 'success',
            data: {
                category: {
                    id: category.id,
                    name: category.name
                },
                projects: parsedProjects,
                count: parsedProjects.length
            }
        });
    } catch (error) {
        console.error('Failed to fetch category projects:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch category projects'
        });
    }
});

module.exports = router;