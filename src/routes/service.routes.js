// src/routes/service.routes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const uploadToCloudinary = require('../utils/cloudinary-upload');
const deleteFromCloudinary = require('../utils/cloudinary-delete');
const prisma = require('../config/prisma');

// Helper to extract Cloudinary public_id from secure URL
const getPublicIdFromUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    try {
        const parts = url.split('/upload/');
        if (parts.length < 2) return null;
        const path = parts[1].replace(/^v\d+\//, '');
        const lastDot = path.lastIndexOf('.');
        return lastDot !== -1 ? path.substring(0, lastDot) : path;
    } catch (e) {
        return null;
    }
};

// Helper to safely parse JSON features
const parseFeatures = (features) => {
    if (!features) return [];
    if (Array.isArray(features)) return features;
    if (typeof features === 'string') {
        try {
            const parsed = JSON.parse(features);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }
    return [];
};

// ============================================
// GET ALL SERVICES (Paginated, Searchable, Filterable)
// ============================================
router.get('/', async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search,
            isActive,
            sortBy = 'displayOrder',
            sortOrder = 'asc'
        } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 10));
        const skip = (pageNum - 1) * limitNum;
        const take = limitNum;

        const where = {};

        if (search && typeof search === 'string' && search.trim() !== '') {
            where.name = { contains: search.trim() };
        }

        if (isActive !== undefined && isActive !== null && isActive !== '') {
            where.isActive = isActive === 'true' || isActive === true;
        }

        const validSortFields = ['displayOrder', 'name', 'createdAt', 'updatedAt'];
        const sortField = validSortFields.includes(sortBy) ? sortBy : 'displayOrder';
        const order = sortOrder === 'desc' ? 'desc' : 'asc';

        const [services, total] = await Promise.all([
            prisma.service.findMany({
                where,
                orderBy: { [sortField]: order },
                skip,
                take
            }),
            prisma.service.count({ where })
        ]);

        const parsedServices = services.map(service => ({
            ...service,
            features: parseFeatures(service.features)
        }));

        res.status(200).json({
            status: 'success',
            data: {
                services: parsedServices,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum) || 1
                }
            }
        });
    } catch (error) {
        console.error('Failed to fetch services:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch services',
            error: error.message || String(error)
        });
    }
});

// ============================================
// GET SERVICE SUMMARY STATS (MUST BE BEFORE /:id)
// ============================================
router.get('/summary/stats', async (req, res) => {
    try {
        const [total, active, inactive] = await Promise.all([
            prisma.service.count(),
            prisma.service.count({ where: { isActive: true } }),
            prisma.service.count({ where: { isActive: false } })
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                total,
                active,
                inactive
            }
        });
    } catch (error) {
        console.error('Failed to get service summary:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get service summary',
            error: error.message || String(error)
        });
    }
});

// ============================================
// GET SINGLE SERVICE BY ID
// ============================================
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!id || id === 'summary') {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid service ID'
            });
        }

        const service = await prisma.service.findUnique({
            where: { id }
        });

        if (!service) {
            return res.status(404).json({
                status: 'error',
                message: 'Service not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: {
                service: {
                    ...service,
                    features: parseFeatures(service.features)
                }
            }
        });
    } catch (error) {
        console.error('Failed to fetch service:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch service',
            error: error.message || String(error)
        });
    }
});

// ============================================
// CREATE SERVICE
// ============================================
router.post('/', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        const { name, icon, description, features, displayOrder, isActive } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Service name is required'
            });
        }

        if (!description || !description.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Service description is required'
            });
        }

        if (!icon || !icon.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Service icon is required'
            });
        }

        // Check duplicate service name
        const existingService = await prisma.service.findFirst({
            where: { name: { equals: name.trim() } }
        });

        if (existingService) {
            return res.status(400).json({
                status: 'error',
                message: 'A service with this name already exists'
            });
        }

        let imageUrl = null;

        if (req.file) {
            try {
                const uploadResult = await uploadToCloudinary(req.file.buffer, 'services');
                imageUrl = uploadResult.secure_url;
            } catch (uploadErr) {
                console.error('Failed to upload service image to Cloudinary:', uploadErr);
            }
        }

        const parsedFeatures = parseFeatures(features);

        const newService = await prisma.service.create({
            data: {
                name: name.trim(),
                icon: icon.trim(),
                description: description.trim(),
                image: imageUrl,
                features: parsedFeatures,
                displayOrder: parseInt(displayOrder) || 0,
                isActive: isActive === 'true' || isActive === true
            }
        });

        res.status(201).json({
            status: 'success',
            data: {
                service: {
                    ...newService,
                    features: parsedFeatures
                }
            },
            message: 'Service created successfully'
        });
    } catch (error) {
        console.error('Failed to create service:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to create service',
            error: error.message || String(error)
        });
    }
});

// ============================================
// UPDATE SERVICE
// ============================================
router.put('/:id', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, icon, description, features, displayOrder, isActive } = req.body;

        const existingService = await prisma.service.findUnique({
            where: { id }
        });

        if (!existingService) {
            return res.status(404).json({
                status: 'error',
                message: 'Service not found'
            });
        }

        if (name && name.trim()) {
            const duplicateCheck = await prisma.service.findFirst({
                where: {
                    name: { equals: name.trim() },
                    id: { not: id }
                }
            });

            if (duplicateCheck) {
                return res.status(400).json({
                    status: 'error',
                    message: 'A service with this name already exists'
                });
            }
        }

        let imageUrl = existingService.image;

        if (req.file) {
            try {
                const uploadResult = await uploadToCloudinary(req.file.buffer, 'services');

                const oldPublicId = getPublicIdFromUrl(existingService.image);
                if (oldPublicId) {
                    try {
                        await deleteFromCloudinary(oldPublicId);
                    } catch (delErr) {
                        console.error('Failed to delete old Cloudinary image:', delErr);
                    }
                }

                imageUrl = uploadResult.secure_url;
            } catch (uploadErr) {
                console.error('Failed to upload updated service image to Cloudinary:', uploadErr);
            }
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name.trim();
        if (icon !== undefined) updateData.icon = icon.trim();
        if (description !== undefined) updateData.description = description.trim();
        if (imageUrl !== undefined) updateData.image = imageUrl;
        if (displayOrder !== undefined) updateData.displayOrder = parseInt(displayOrder) || 0;
        if (isActive !== undefined) updateData.isActive = isActive === 'true' || isActive === true;

        if (features !== undefined) {
            const parsedFeatures = parseFeatures(features);
            updateData.features = parsedFeatures;
        }

        const updatedService = await prisma.service.update({
            where: { id },
            data: updateData
        });

        res.status(200).json({
            status: 'success',
            data: {
                service: {
                    ...updatedService,
                    features: parseFeatures(updatedService.features)
                }
            },
            message: 'Service updated successfully'
        });
    } catch (error) {
        console.error('Failed to update service:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update service',
            error: error.message || String(error)
        });
    }
});

// ============================================
// TOGGLE SERVICE ACTIVE/INACTIVE STATUS
// ============================================
router.patch('/:id/toggle', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const existingService = await prisma.service.findUnique({
            where: { id }
        });

        if (!existingService) {
            return res.status(404).json({
                status: 'error',
                message: 'Service not found'
            });
        }

        const updatedService = await prisma.service.update({
            where: { id },
            data: { isActive: !existingService.isActive }
        });

        res.status(200).json({
            status: 'success',
            data: {
                service: {
                    ...updatedService,
                    features: parseFeatures(updatedService.features)
                }
            },
            message: `Service ${updatedService.isActive ? 'activated' : 'deactivated'} successfully`
        });
    } catch (error) {
        console.error('Failed to toggle service status:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to toggle service status',
            error: error.message || String(error)
        });
    }
});

// ============================================
// UPDATE DISPLAY ORDER
// ============================================
router.patch('/:id/order', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { displayOrder } = req.body;

        if (displayOrder === undefined || isNaN(parseInt(displayOrder))) {
            return res.status(400).json({
                status: 'error',
                message: 'Display order must be a valid number'
            });
        }

        const existingService = await prisma.service.findUnique({
            where: { id }
        });

        if (!existingService) {
            return res.status(404).json({
                status: 'error',
                message: 'Service not found'
            });
        }

        const updatedService = await prisma.service.update({
            where: { id },
            data: { displayOrder: parseInt(displayOrder) }
        });

        res.status(200).json({
            status: 'success',
            data: { service: updatedService },
            message: 'Display order updated successfully'
        });
    } catch (error) {
        console.error('Failed to update display order:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update display order',
            error: error.message || String(error)
        });
    }
});

// ============================================
// DELETE SERVICE
// ============================================
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const existingService = await prisma.service.findUnique({
            where: { id }
        });

        if (!existingService) {
            return res.status(404).json({
                status: 'error',
                message: 'Service not found'
            });
        }

        const publicId = getPublicIdFromUrl(existingService.image);
        if (publicId) {
            try {
                await deleteFromCloudinary(publicId);
            } catch (cloudinaryErr) {
                console.error('Failed to delete image from Cloudinary:', cloudinaryErr);
            }
        }

        await prisma.service.delete({
            where: { id }
        });

        res.status(200).json({
            status: 'success',
            message: 'Service deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete service:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete service',
            error: error.message || String(error)
        });
    }
});

module.exports = router;