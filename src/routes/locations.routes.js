const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const uploadToCloudinary = require('../utils/cloudinary-upload');
const deleteFromCloudinary = require('../utils/cloudinary-delete');
const prisma = require('../config/prisma');
const generateSlug = (text) => text.toString().toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-');

// Get all locations (public or admin)
router.get('/', async (req, res) => {
    try {
        const { city, featured, isActive } = req.query;
        const locations = await prisma.location.findMany({
            where: {
                ...(isActive !== undefined && { isActive: isActive === 'true' }),
                ...(city && { city }),
                ...(featured === 'true' && { isFeatured: true }),
            },
            orderBy: [
                { displayOrder: 'asc' },
                { name: 'asc' }
            ],
        });
        res.status(200).json({
            status: 'success',
            data: { locations }
        });
    } catch (error) {
        console.error('[LOCATIONS API ERROR]', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch locations'
        });
    }
});

// Get single location
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const location = await prisma.location.findFirst({
            where: {
                OR: [
                    { id: id },
                    { slug: id }
                ]
            }
        });

        if (!location) {
            return res.status(404).json({
                status: 'error',
                message: 'Location not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: { location }
        });
    } catch (error) {
        console.error('[LOCATIONS API ERROR]', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch location'
        });
    }
});

// Create location
router.post('/', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        const { name, slug, city, province, country, latitude, longitude, description, isActive, isFeatured, displayOrder } = req.body;
        let image = req.body.image || null;
        let imagePublicId = null;

        if (req.file) {
            const result = await uploadToCloudinary(req.file, 'novinka/locations');
            image = result.secure_url;
            imagePublicId = result.public_id;
        }

        const generatedSlug = slug || generateSlug(name);

        const location = await prisma.location.create({
            data: {
                name,
                slug: generatedSlug,
                city,
                province,
                country: country || 'Pakistan',
                latitude: latitude ? parseFloat(latitude) : null,
                longitude: longitude ? parseFloat(longitude) : null,
                description,
                image,
                imagePublicId,
                isActive: isActive === 'true' || isActive === true,
                isFeatured: isFeatured === 'true' || isFeatured === true,
                displayOrder: displayOrder ? parseInt(displayOrder, 10) : 0
            }
        });

        res.status(201).json({
            status: 'success',
            data: { location },
            message: 'Location created successfully'
        });
    } catch (error) {
        console.error('[LOCATIONS API ERROR]', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create location'
        });
    }
});

// Update location
router.put('/:id', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        const existingLocation = await prisma.location.findUnique({
            where: { id }
        });

        if (!existingLocation) {
            return res.status(404).json({
                status: 'error',
                message: 'Location not found'
            });
        }

        const { name, slug, city, province, country, latitude, longitude, description, isActive, isFeatured, displayOrder } = req.body;

        let image = existingLocation.image;
        let imagePublicId = existingLocation.imagePublicId;

        if (req.file) {
            if (existingLocation.imagePublicId) {
                try {
                    await deleteFromCloudinary(existingLocation.imagePublicId);
                } catch (destroyErr) {
                    console.error('Failed to delete previous Cloudinary image:', destroyErr);
                }
            }

            const result = await uploadToCloudinary(req.file, 'novinka/locations');
            image = result.secure_url;
            imagePublicId = result.public_id;
        }

        const location = await prisma.location.update({
            where: { id },
            data: {
                name: name || existingLocation.name,
                slug: slug || existingLocation.slug,
                city: city !== undefined ? city : existingLocation.city,
                province: province !== undefined ? province : existingLocation.province,
                country: country !== undefined ? country : existingLocation.country,
                latitude: latitude !== undefined ? (latitude ? parseFloat(latitude) : null) : existingLocation.latitude,
                longitude: longitude !== undefined ? (longitude ? parseFloat(longitude) : null) : existingLocation.longitude,
                description: description !== undefined ? description : existingLocation.description,
                image,
                imagePublicId,
                isActive: isActive !== undefined ? (isActive === 'true' || isActive === true) : existingLocation.isActive,
                isFeatured: isFeatured !== undefined ? (isFeatured === 'true' || isFeatured === true) : existingLocation.isFeatured,
                displayOrder: displayOrder !== undefined ? parseInt(displayOrder, 10) : existingLocation.displayOrder
            }
        });

        res.status(200).json({
            status: 'success',
            data: { location },
            message: 'Location updated successfully'
        });
    } catch (error) {
        console.error('[LOCATIONS API ERROR]', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update location'
        });
    }
});

// Delete location
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const location = await prisma.location.findUnique({
            where: { id }
        });

        if (!location) {
            return res.status(404).json({
                status: 'error',
                message: 'Location not found'
            });
        }

        if (location.imagePublicId) {
            try {
                await deleteFromCloudinary(location.imagePublicId);
            } catch (cloudinaryErr) {
                console.error('Failed to delete image from Cloudinary:', cloudinaryErr);
            }
        }

        await prisma.location.delete({
            where: { id }
        });

        res.status(200).json({
            status: 'success',
            message: 'Location deleted successfully'
        });
    } catch (error) {
        console.error('[LOCATIONS API ERROR]', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete location'
        });
    }
});

module.exports = router;