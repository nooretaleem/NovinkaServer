// src/routes/project.routes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const uploadToCloudinary = require('../utils/cloudinary-upload');
const deleteFromCloudinary = require('../utils/cloudinary-delete');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Helper function to safely parse gallery fields
function parseGalleryField(gallery) {
    if (!gallery) return [];
    if (Array.isArray(gallery)) return gallery;
    if (typeof gallery === 'string') {
        try {
            const parsed = JSON.parse(gallery);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }
    return [];
}

// Get all projects
router.get('/', async (req, res) => {
    try {
        const projects = await prisma.project.findMany({
            orderBy: [
                { isFeatured: 'desc' },
                { displayOrder: 'asc' },
                { createdAt: 'desc' }
            ]
        });

        // Safely parse gallery fields
        const parsedProjects = projects.map(project => ({
            ...project,
            gallery: parseGalleryField(project.gallery)
        }));

        res.status(200).json({
            status: 'success',
            data: { projects: parsedProjects }
        });
    } catch (error) {
        console.error('[PROJECTS API ERROR]', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch projects'
        });
    }
});

// Get single project
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const project = await prisma.project.findUnique({
            where: { id }
        });

        if (!project) {
            return res.status(404).json({
                status: 'error',
                message: 'Project not found'
            });
        }

        // Safely parse gallery fields
        const parsedProject = {
            ...project,
            gallery: parseGalleryField(project.gallery)
        };

        res.status(200).json({
            status: 'success',
            data: { project: parsedProject }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch project'
        });
    }
});

// Create project
router.post('/', authMiddleware, upload.single('coverImage'), async (req, res) => {
    try {
        const { title, location, projectType, description, gallery, completionDate, isFeatured, displayOrder } = req.body;
        let coverImage = req.body.coverImage || null;
        let coverImagePublicId = null;

        if (req.file) {
            const result = await uploadToCloudinary(req.file, 'novinka/projects');
            coverImage = result.secure_url;
            coverImagePublicId = result.public_id;
        }

        let parsedGallery = gallery;
        if (typeof gallery === 'string') {
            try {
                parsedGallery = JSON.parse(gallery);
            } catch (e) {
                parsedGallery = gallery;
            }
        }

        const project = await prisma.project.create({
            data: {
                title,
                location,
                projectType,
                description,
                coverImage,
                coverImagePublicId,
                gallery: parsedGallery ? JSON.stringify(parsedGallery) : null,
                completionDate: completionDate ? new Date(completionDate) : null,
                isFeatured: isFeatured === 'true' || isFeatured === true,
                displayOrder: displayOrder ? parseInt(displayOrder, 10) : 0
            }
        });

        res.status(201).json({
            status: 'success',
            data: { project },
            message: 'Project created successfully'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create project'
        });
    }
});

// Update project
router.put('/:id', authMiddleware, upload.single('coverImage'), async (req, res) => {
    try {
        const { id } = req.params;
        const existingProject = await prisma.project.findUnique({
            where: { id }
        });

        if (!existingProject) {
            return res.status(404).json({
                status: 'error',
                message: 'Project not found'
            });
        }

        const { title, location, projectType, description, gallery, completionDate, isFeatured, displayOrder } = req.body;

        let coverImage = existingProject.coverImage;
        let coverImagePublicId = existingProject.coverImagePublicId;

        if (req.file) {
            // Delete previous Cloudinary image using helper if public_id exists
            if (existingProject.coverImagePublicId) {
                try {
                    await deleteFromCloudinary(existingProject.coverImagePublicId);
                } catch (destroyErr) {
                    console.error('Failed to delete previous Cloudinary image:', destroyErr);
                }
            }

            // Upload new image to Cloudinary using helper
            const result = await uploadToCloudinary(req.file, 'novinka/projects');
            coverImage = result.secure_url;
            coverImagePublicId = result.public_id;
        }

        let parsedGallery = gallery;
        if (typeof gallery === 'string') {
            try {
                parsedGallery = JSON.parse(gallery);
            } catch (e) {
                parsedGallery = gallery;
            }
        }

        const project = await prisma.project.update({
            where: { id },
            data: {
                title: title || existingProject.title,
                location: location || existingProject.location,
                projectType: projectType || existingProject.projectType,
                description: description || existingProject.description,
                coverImage,
                coverImagePublicId,
                gallery: parsedGallery ? JSON.stringify(parsedGallery) : existingProject.gallery,
                completionDate: completionDate ? new Date(completionDate) : existingProject.completionDate,
                isFeatured: isFeatured !== undefined ? (isFeatured === 'true' || isFeatured === true) : existingProject.isFeatured,
                displayOrder: displayOrder !== undefined ? parseInt(displayOrder, 10) : existingProject.displayOrder
            }
        });

        res.status(200).json({
            status: 'success',
            data: { project },
            message: 'Project updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update project'
        });
    }
});

// Delete project
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const project = await prisma.project.findUnique({
            where: { id }
        });

        if (!project) {
            return res.status(404).json({
                status: 'error',
                message: 'Project not found'
            });
        }

        if (project.coverImagePublicId) {
            try {
                await deleteFromCloudinary(project.coverImagePublicId);
            } catch (cloudinaryErr) {
                console.error('Failed to delete image from Cloudinary:', cloudinaryErr);
            }
        }

        await prisma.project.delete({
            where: { id }
        });

        res.status(200).json({
            status: 'success',
            message: 'Project deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete project'
        });
    }
});

module.exports = router;