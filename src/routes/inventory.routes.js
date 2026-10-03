// ============================================
// INVENTORY ROUTES - NOVINKA CONSTRUCTIONS
// ============================================
const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const uploadToCloudinary = require('../utils/cloudinary-upload');
const deleteFromCloudinary = require('../utils/cloudinary-delete');

/**
 * Generate a URL-friendly slug from a string
 */
function generateSlug(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Helper to safely parse JSON or return Array/Object
 */
function parseJsonField(field, defaultValue = []) {
    if (!field) return defaultValue;
    if (Array.isArray(field)) return field;
    if (typeof field === 'object') return field;
    if (typeof field === 'string') {
        try {
            return JSON.parse(field);
        } catch (e) {
            return defaultValue;
        }
    }
    return defaultValue;
}

/**
 * Helper to format gallery item objects
 */
function normalizeGalleryItem(item) {
    if (!item) return null;
    if (typeof item === 'string') {
        return { url: item, publicId: null, alt: null };
    }
    if (typeof item === 'object') {
        return {
            url: item.url || item.secure_url || '',
            publicId: item.publicId || item.public_id || null,
            alt: item.alt || null
        };
    }
    return null;
}

/**
 * GET /api/inventory
 * Public endpoint to get all inventory items with filtering, search, and sorting
 */
router.get('/', async (req, res) => {
    try {
        const { type, status, search, featured, page, limit } = req.query;

        const where = {};

        // Type filter (PLOT, HOUSE)
        if (type) {
            const upperType = type.toUpperCase();
            if (['PLOT', 'HOUSE'].includes(upperType)) {
                where.type = upperType;
            } else {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid type parameter. Allowed values: PLOT, HOUSE'
                });
            }
        }

        // Status filter (AVAILABLE, RESERVED, SOLD, UNAVAILABLE)
        if (status) {
            const upperStatus = status.toUpperCase();
            if (['AVAILABLE', 'RESERVED', 'SOLD', 'UNAVAILABLE'].includes(upperStatus)) {
                where.status = upperStatus;
            } else {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid status parameter. Allowed values: AVAILABLE, RESERVED, SOLD, UNAVAILABLE'
                });
            }
        }

        // Featured filter
        if (featured === 'true' || featured === '1') {
            where.isFeatured = true;
        } else if (featured === 'false' || featured === '0') {
            where.isFeatured = false;
        }

        // Keyword search (title, location, size)
        if (search && search.trim()) {
            const term = search.trim();
            where.OR = [
                { title: { contains: term } },
                { location: { contains: term } },
                { size: { contains: term } }
            ];
        }

        // Pagination
        const pageNum = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
        const limitNum = parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 50;
        const skip = (pageNum - 1) * limitNum;

        const [items, total] = await Promise.all([
            prisma.inventory.findMany({
                where,
                orderBy: [
                    { isFeatured: 'desc' },
                    { displayOrder: 'asc' },
                    { createdAt: 'desc' }
                ],
                skip,
                take: limitNum
            }),
            prisma.inventory.count({ where })
        ]);

        const parsedItems = items.map(item => ({
            ...item,
            features: parseJsonField(item.features, []),
            gallery: parseJsonField(item.gallery, [])
        }));

        res.status(200).json({
            status: 'success',
            data: {
                inventory: parsedItems,
                pagination: {
                    total,
                    page: pageNum,
                    pages: Math.ceil(total / limitNum) || 1,
                    limit: limitNum
                }
            }
        });
    } catch (error) {
        console.error('[INVENTORY GET ALL ERROR]', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch inventory items'
        });
    }
});

/**
 * GET /api/inventory/:id
 * Public endpoint to fetch single inventory by ID or slug
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        let item = await prisma.inventory.findUnique({
            where: { id }
        });

        if (!item) {
            item = await prisma.inventory.findUnique({
                where: { slug: id }
            });
        }

        if (!item) {
            return res.status(404).json({
                status: 'error',
                message: 'Inventory item not found'
            });
        }

        const parsedItem = {
            ...item,
            features: parseJsonField(item.features, []),
            gallery: parseJsonField(item.gallery, [])
        };

        res.status(200).json({
            status: 'success',
            data: {
                inventory: parsedItem
            }
        });
    } catch (error) {
        console.error('[INVENTORY GET SINGLE ERROR]', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch inventory item'
        });
    }
});

/**
 * POST /api/inventory
 * Authenticated Admin/Manager endpoint to create inventory item with Cloudinary image upload & safe rollback
 */
router.post('/',
    authMiddleware,
    roleMiddleware(['ADMIN', 'MANAGER']),
    upload.fields([
        { name: 'coverImage', maxCount: 1 },
        { name: 'gallery', maxCount: 10 }
    ]),
    async (req, res) => {
        const newlyUploadedPublicIds = [];

        try {
            const {
                type,
                title,
                slug,
                location,
                size,
                price,
                status,
                description,
                features,
                isFeatured,
                displayOrder
            } = req.body;

            // Required fields validation
            if (!title || typeof title !== 'string' || !title.trim()) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Title is required'
                });
            }

            if (!type || !['PLOT', 'HOUSE'].includes(type.toUpperCase())) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Valid type is required. Allowed values: PLOT, HOUSE'
                });
            }

            if (!location || typeof location !== 'string' || !location.trim()) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Location is required'
                });
            }

            if (!size || typeof size !== 'string' || !size.trim()) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Size is required'
                });
            }

            // Price validation
            let parsedPrice = null;
            if (price !== undefined && price !== null && price !== '') {
                parsedPrice = parseFloat(price);
                if (isNaN(parsedPrice) || parsedPrice < 0) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Price must be a valid non-negative number'
                    });
                }
            }

            // Status validation
            let itemStatus = 'AVAILABLE';
            if (status) {
                const upperStatus = status.toUpperCase();
                if (!['AVAILABLE', 'RESERVED', 'SOLD', 'UNAVAILABLE'].includes(upperStatus)) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Invalid status. Allowed values: AVAILABLE, RESERVED, SOLD, UNAVAILABLE'
                    });
                }
                itemStatus = upperStatus;
            }

            // 1. Cover Image Upload
            let coverImage = req.body.coverImage || null;
            let coverImagePublicId = req.body.coverImagePublicId || null;

            if (req.files && req.files.coverImage && req.files.coverImage[0]) {
                const coverUploadResult = await uploadToCloudinary(req.files.coverImage[0], 'novinka/inventory');
                coverImage = coverUploadResult.secure_url;
                coverImagePublicId = coverUploadResult.public_id;
                newlyUploadedPublicIds.push(coverUploadResult.public_id);
            }

            // 2. Gallery Upload & Payload Formatting
            let finalGallery = [];

            // Existing gallery JSON passed in body (e.g. pre-uploaded or existing)
            if (req.body.gallery) {
                const rawGallery = parseJsonField(req.body.gallery, []);
                finalGallery = rawGallery
                    .map(item => normalizeGalleryItem(item))
                    .filter(Boolean);
            }

            // Newly uploaded gallery files in multipart form-data
            if (req.files && req.files.gallery && req.files.gallery.length > 0) {
                for (const file of req.files.gallery) {
                    const galleryUploadResult = await uploadToCloudinary(file, 'novinka/inventory');
                    finalGallery.push({
                        url: galleryUploadResult.secure_url,
                        publicId: galleryUploadResult.public_id,
                        alt: req.body.galleryAlt || null
                    });
                    newlyUploadedPublicIds.push(galleryUploadResult.public_id);
                }
            }

            // Slug handling
            let finalSlug = slug ? generateSlug(slug) : generateSlug(title);
            if (!finalSlug) {
                finalSlug = `inventory-${Date.now()}`;
            }

            const existingSlug = await prisma.inventory.findUnique({
                where: { slug: finalSlug }
            });

            if (existingSlug) {
                finalSlug = `${finalSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
            }

            const parsedFeatures = parseJsonField(features, []);

            // 3. Save to Database
            let newItem;
            try {
                newItem = await prisma.inventory.create({
                    data: {
                        type: type.toUpperCase(),
                        title: title.trim(),
                        slug: finalSlug,
                        location: location.trim(),
                        size: size.trim(),
                        price: parsedPrice,
                        status: itemStatus,
                        description: description ? description.trim() : null,
                        features: parsedFeatures,
                        coverImage: coverImage,
                        coverImagePublicId: coverImagePublicId,
                        gallery: finalGallery,
                        isFeatured: isFeatured === true || isFeatured === 'true',
                        displayOrder: parseInt(displayOrder, 10) || 0
                    }
                });
            } catch (dbError) {
                // ORPHANED CLOUDINARY ASSETS CLEANUP ON DB FAILURE
                console.error('[INVENTORY CREATE DB ERROR] Cleaning up Cloudinary uploads...', dbError);
                for (const pid of newlyUploadedPublicIds) {
                    try {
                        await deleteFromCloudinary(pid);
                    } catch (cleanupErr) {
                        console.error(`Failed to cleanup orphaned asset [${pid}]:`, cleanupErr);
                    }
                }
                throw dbError;
            }

            res.status(201).json({
                status: 'success',
                message: 'Inventory item created successfully',
                data: {
                    inventory: {
                        ...newItem,
                        features: parseJsonField(newItem.features, []),
                        gallery: parseJsonField(newItem.gallery, [])
                    }
                }
            });
        } catch (error) {
            console.error('[INVENTORY CREATE ERROR]', error);
            res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to create inventory item'
            });
        }
    }
);

/**
 * PATCH /api/inventory/:id
 * Authenticated Admin/Manager endpoint for partial updates, safe image replacement, and gallery management
 */
router.patch('/:id',
    authMiddleware,
    roleMiddleware(['ADMIN', 'MANAGER']),
    upload.fields([
        { name: 'coverImage', maxCount: 1 },
        { name: 'gallery', maxCount: 10 }
    ]),
    async (req, res) => {
        const newlyUploadedPublicIds = [];
        const oldPublicIdsToDelete = [];

        try {
            const { id } = req.params;

            const existingItem = await prisma.inventory.findUnique({
                where: { id }
            });

            if (!existingItem) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Inventory item not found'
                });
            }

            const updateData = {};
            const {
                type,
                title,
                slug,
                location,
                size,
                price,
                status,
                description,
                features,
                coverImage,
                coverImagePublicId,
                gallery,
                isFeatured,
                displayOrder
            } = req.body;

            // Basic Field Validations
            if (title !== undefined) {
                if (!title || typeof title !== 'string' || !title.trim()) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Title cannot be empty'
                    });
                }
                updateData.title = title.trim();
            }

            if (type !== undefined) {
                const upperType = type.toUpperCase();
                if (!['PLOT', 'HOUSE'].includes(upperType)) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Invalid type. Allowed values: PLOT, HOUSE'
                    });
                }
                updateData.type = upperType;
            }

            if (location !== undefined) {
                if (!location || typeof location !== 'string' || !location.trim()) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Location cannot be empty'
                    });
                }
                updateData.location = location.trim();
            }

            if (size !== undefined) {
                if (!size || typeof size !== 'string' || !size.trim()) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Size cannot be empty'
                    });
                }
                updateData.size = size.trim();
            }

            if (price !== undefined) {
                if (price === null || price === '') {
                    updateData.price = null;
                } else {
                    const parsedPrice = parseFloat(price);
                    if (isNaN(parsedPrice) || parsedPrice < 0) {
                        return res.status(400).json({
                            status: 'error',
                            message: 'Price must be a valid non-negative number'
                        });
                    }
                    updateData.price = parsedPrice;
                }
            }

            if (status !== undefined) {
                const upperStatus = status.toUpperCase();
                if (!['AVAILABLE', 'RESERVED', 'SOLD', 'UNAVAILABLE'].includes(upperStatus)) {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Invalid status. Allowed values: AVAILABLE, RESERVED, SOLD, UNAVAILABLE'
                    });
                }
                updateData.status = upperStatus;
            }

            if (slug !== undefined) {
                const finalSlug = generateSlug(slug);
                if (finalSlug && finalSlug !== existingItem.slug) {
                    const slugTaken = await prisma.inventory.findUnique({
                        where: { slug: finalSlug }
                    });
                    if (slugTaken && slugTaken.id !== id) {
                        return res.status(400).json({
                            status: 'error',
                            message: 'Slug is already in use by another inventory item'
                        });
                    }
                    updateData.slug = finalSlug;
                }
            }

            if (description !== undefined) {
                updateData.description = description ? description.trim() : null;
            }

            if (features !== undefined) {
                updateData.features = parseJsonField(features, []);
            }

            // 1. Cover Image Replacement Logic
            if (req.files && req.files.coverImage && req.files.coverImage[0]) {
                const coverUploadResult = await uploadToCloudinary(req.files.coverImage[0], 'novinka/inventory');
                updateData.coverImage = coverUploadResult.secure_url;
                updateData.coverImagePublicId = coverUploadResult.public_id;
                newlyUploadedPublicIds.push(coverUploadResult.public_id);

                // Queue previous cover image for deletion AFTER database update succeeds
                if (existingItem.coverImagePublicId) {
                    oldPublicIdsToDelete.push(existingItem.coverImagePublicId);
                }
            } else if (coverImage !== undefined) {
                updateData.coverImage = coverImage || null;
                updateData.coverImagePublicId = coverImagePublicId || null;
                if (existingItem.coverImagePublicId && coverImagePublicId !== existingItem.coverImagePublicId) {
                    oldPublicIdsToDelete.push(existingItem.coverImagePublicId);
                }
            }

            // 2. Gallery Update & Removal Logic
            if (gallery !== undefined || (req.files && req.files.gallery && req.files.gallery.length > 0)) {
                let currentGallery = parseJsonField(existingItem.gallery, []);
                let retainedGallery = gallery !== undefined
                    ? parseJsonField(gallery, []).map(normalizeGalleryItem).filter(Boolean)
                    : currentGallery;

                // Identify gallery publicIds that were removed by the update
                const retainedPublicIds = new Set(retainedGallery.map(g => g.publicId).filter(Boolean));
                for (const item of currentGallery) {
                    const gItem = normalizeGalleryItem(item);
                    if (gItem && gItem.publicId && !retainedPublicIds.has(gItem.publicId)) {
                        oldPublicIdsToDelete.push(gItem.publicId);
                    }
                }

                // Add newly uploaded gallery files
                if (req.files && req.files.gallery && req.files.gallery.length > 0) {
                    for (const file of req.files.gallery) {
                        const galleryUploadResult = await uploadToCloudinary(file, 'novinka/inventory');
                        retainedGallery.push({
                            url: galleryUploadResult.secure_url,
                            publicId: galleryUploadResult.public_id,
                            alt: req.body.galleryAlt || null
                        });
                        newlyUploadedPublicIds.push(galleryUploadResult.public_id);
                    }
                }

                updateData.gallery = retainedGallery;
            }

            if (isFeatured !== undefined) {
                updateData.isFeatured = isFeatured === true || isFeatured === 'true';
            }

            if (displayOrder !== undefined) {
                updateData.displayOrder = parseInt(displayOrder, 10) || 0;
            }

            // 3. Database Update
            let updatedItem;
            try {
                updatedItem = await prisma.inventory.update({
                    where: { id },
                    data: updateData
                });
            } catch (dbError) {
                // Clean up newly uploaded files if DB update fails
                console.error('[INVENTORY UPDATE DB ERROR] Cleaning up new Cloudinary uploads...', dbError);
                for (const pid of newlyUploadedPublicIds) {
                    try {
                        await deleteFromCloudinary(pid);
                    } catch (cleanupErr) {
                        console.error(`Failed to cleanup orphaned asset [${pid}]:`, cleanupErr);
                    }
                }
                throw dbError;
            }

            // 4. Safe Post-Update Deletion of Old Replaced Cloudinary Assets
            for (const oldPid of oldPublicIdsToDelete) {
                try {
                    await deleteFromCloudinary(oldPid);
                } catch (deleteErr) {
                    console.error(`Failed to delete old replaced Cloudinary asset [${oldPid}]:`, deleteErr);
                }
            }

            res.status(200).json({
                status: 'success',
                message: 'Inventory item updated successfully',
                data: {
                    inventory: {
                        ...updatedItem,
                        features: parseJsonField(updatedItem.features, []),
                        gallery: parseJsonField(updatedItem.gallery, [])
                    }
                }
            });
        } catch (error) {
            console.error('[INVENTORY UPDATE ERROR]', error);
            res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to update inventory item'
            });
        }
    }
);

/**
 * DELETE /api/inventory/:id
 * Authenticated Admin/Manager endpoint to delete an inventory record and its Cloudinary assets
 */
router.delete('/:id', authMiddleware, roleMiddleware(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const { id } = req.params;

        const existingItem = await prisma.inventory.findUnique({
            where: { id }
        });

        if (!existingItem) {
            return res.status(404).json({
                status: 'error',
                message: 'Inventory item not found'
            });
        }

        // Collect all Cloudinary publicIds (cover image + gallery images)
        const pidsToDelete = [];
        if (existingItem.coverImagePublicId) {
            pidsToDelete.push(existingItem.coverImagePublicId);
        }

        const galleryItems = parseJsonField(existingItem.gallery, []);
        for (const item of galleryItems) {
            const gItem = normalizeGalleryItem(item);
            if (gItem && gItem.publicId) {
                pidsToDelete.push(gItem.publicId);
            }
        }

        // 1. Delete Database Record First
        await prisma.inventory.delete({
            where: { id }
        });

        // 2. Delete Associated Cloudinary Assets Cleanly
        for (const pid of pidsToDelete) {
            try {
                await deleteFromCloudinary(pid);
            } catch (cloudErr) {
                console.error(`Failed to delete Cloudinary asset [${pid}] during inventory deletion:`, cloudErr);
            }
        }

        res.status(200).json({
            status: 'success',
            message: 'Inventory item and associated image assets deleted successfully'
        });
    } catch (error) {
        console.error('[INVENTORY DELETE ERROR]', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete inventory item'
        });
    }
});

module.exports = router;
