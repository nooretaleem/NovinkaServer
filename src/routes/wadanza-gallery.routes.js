const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const uploadToCloudinary = require('../utils/cloudinary-upload');

const router = express.Router();
const prisma = new PrismaClient();

// Multipart form fields arrive as strings, so 'false' must not be coerced via Boolean()
const parseBool = (value) => value === true || value === 'true';

// GET /api/wadanza-gallery
// Query params: projectId ('wadanza-1' | 'wadanza-2'), onlyActive ('true' | 'false')
router.get('/', async (req, res) => {
    try {
        const { projectId, onlyActive } = req.query;

        const where = {};
        if (projectId) {
            where.projectId = String(projectId);
        }
        if (onlyActive === 'true') {
            where.isActive = true;
        }

        const images = await prisma.wadanzaGalleryImage.findMany({
            where,
            orderBy: [
                { displayOrder: 'asc' },
                { createdAt: 'desc' }
            ]
        });

        res.json({
            status: 'success',
            data: { images }
        });
    } catch (error) {
        console.error('Error fetching wadanza gallery images:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch gallery images' });
    }
});

// POST /api/wadanza-gallery/upload
// Admin: upload a single image to Cloudinary and return its secure URL
router.post('/upload', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ status: 'error', message: 'No image file uploaded' });
        }

        const result = await uploadToCloudinary(req.file, 'novinka/wadanza-gallery');

        res.status(200).json({
            status: 'success',
            data: { imageUrl: result.secure_url, publicId: result.public_id }
        });
    } catch (error) {
        console.error('Error uploading wadanza gallery image:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Failed to upload image' });
    }
});

// POST /api/wadanza-gallery
// Admin add new gallery image
router.post('/', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        const { projectId, title, displayOrder, isActive } = req.body;
        let imageUrl = req.body.imageUrl;

        if (req.file) {
            const result = await uploadToCloudinary(req.file, 'novinka/wadanza-gallery');
            imageUrl = result.secure_url;
        }

        if (!projectId || !imageUrl || !title) {
            return res.status(400).json({
                status: 'error',
                message: 'projectId, image (file or imageUrl), and title are required fields'
            });
        }

        const newImage = await prisma.wadanzaGalleryImage.create({
            data: {
                projectId: String(projectId),
                imageUrl: String(imageUrl),
                title: String(title),
                displayOrder: displayOrder !== undefined ? parseInt(displayOrder) : 0,
                isActive: isActive !== undefined ? parseBool(isActive) : true
            }
        });

        res.status(201).json({
            status: 'success',
            data: { image: newImage }
        });
    } catch (error) {
        console.error('Error adding wadanza gallery image:', error);
        res.status(500).json({ status: 'error', message: 'Failed to add gallery image' });
    }
});

// PUT /api/wadanza-gallery/:id
// Admin update gallery image
router.put('/:id', authMiddleware, upload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { projectId, title, displayOrder, isActive } = req.body;
        let imageUrl = req.body.imageUrl;

        const existing = await prisma.wadanzaGalleryImage.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ status: 'error', message: 'Gallery image not found' });
        }

        if (req.file) {
            const result = await uploadToCloudinary(req.file, 'novinka/wadanza-gallery');
            imageUrl = result.secure_url;
        }

        const updateData = {};
        if (projectId !== undefined) updateData.projectId = String(projectId);
        if (imageUrl !== undefined) updateData.imageUrl = String(imageUrl);
        if (title !== undefined) updateData.title = String(title);
        if (displayOrder !== undefined) updateData.displayOrder = parseInt(displayOrder);
        if (isActive !== undefined) updateData.isActive = parseBool(isActive);

        const updatedImage = await prisma.wadanzaGalleryImage.update({
            where: { id },
            data: updateData
        });

        res.json({
            status: 'success',
            data: { image: updatedImage }
        });
    } catch (error) {
        console.error('Error updating wadanza gallery image:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update gallery image' });
    }
});

// PATCH /api/wadanza-gallery/:id (Alias for partial updates)
router.patch('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { projectId, imageUrl, title, displayOrder, isActive } = req.body;

        const existing = await prisma.wadanzaGalleryImage.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ status: 'error', message: 'Gallery image not found' });
        }

        const updateData = {};
        if (projectId !== undefined) updateData.projectId = String(projectId);
        if (imageUrl !== undefined) updateData.imageUrl = String(imageUrl);
        if (title !== undefined) updateData.title = String(title);
        if (displayOrder !== undefined) updateData.displayOrder = parseInt(displayOrder);
        if (isActive !== undefined) updateData.isActive = Boolean(isActive);

        const updatedImage = await prisma.wadanzaGalleryImage.update({
            where: { id },
            data: updateData
        });

        res.json({
            status: 'success',
            data: { image: updatedImage }
        });
    } catch (error) {
        console.error('Error updating wadanza gallery image:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update gallery image' });
    }
});

// DELETE /api/wadanza-gallery/:id
// Admin delete gallery image
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.wadanzaGalleryImage.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ status: 'error', message: 'Gallery image not found' });
        }

        await prisma.wadanzaGalleryImage.delete({ where: { id } });

        res.json({
            status: 'success',
            message: 'Gallery image deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting wadanza gallery image:', error);
        res.status(500).json({ status: 'error', message: 'Failed to delete gallery image' });
    }
});

module.exports = router;
