// src/routes/project.routes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const uploadToCloudinary = require('../utils/cloudinary-upload');
const deleteFromCloudinary = require('../utils/cloudinary-delete');
const prisma = require('../config/prisma');

// Helper function to safely parse gallery fields
function parseGalleryField(gallery) {
    if (!gallery) return [];
    let items = gallery;
    if (typeof gallery === 'string') {
        try {
            items = JSON.parse(gallery);
        } catch (e) {
            return [];
        }
    }
    if (!Array.isArray(items)) return [];
    return items.map(item => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object' && item.url) return String(item.url).trim();
        return null;
    }).filter(Boolean);
}

// Get all projects
router.get('/', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

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
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

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
router.post('/', authMiddleware, upload.any(), async (req, res) => {
    try {
        const { title, location, projectType, description, gallery, completionDate, isFeatured, displayOrder } = req.body;
        let coverImage = req.body.coverImage || null;
        let coverImagePublicId = null;

        const coverFile = req.files?.find(f => f.fieldname === 'coverImage');
        const galleryFiles = req.files?.filter(f => f.fieldname === 'galleryImages' || f.fieldname === 'galleryFiles' || f.fieldname === 'gallery') || [];

        if (coverFile) {
            const result = await uploadToCloudinary(coverFile, 'novinka/projects');
            coverImage = result.secure_url;
            coverImagePublicId = result.public_id;
        }

        let uploadedGalleryUrls = [];
        if (galleryFiles.length > 0) {
            const uploadResults = await Promise.all(
                galleryFiles.map(file => uploadToCloudinary(file, 'novinka/projects/gallery'))
            );
            uploadedGalleryUrls = uploadResults.map(r => r.secure_url);
        }

        const existingGalleryUrls = parseGalleryField(gallery);
        const finalGallery = [...existingGalleryUrls, ...uploadedGalleryUrls];

        const project = await prisma.project.create({
            data: {
                title,
                location,
                projectType,
                description,
                coverImage,
                coverImagePublicId,
                gallery: finalGallery,
                completionDate: completionDate ? new Date(completionDate) : null,
                isFeatured: isFeatured === 'true' || isFeatured === true,
                displayOrder: displayOrder ? parseInt(displayOrder, 10) : 0
            }
        });

        res.status(201).json({
            status: 'success',
            data: {
                project: {
                    ...project,
                    gallery: parseGalleryField(project.gallery)
                }
            },
            message: 'Project created successfully'
        });
    } catch (error) {
        console.error('[CREATE PROJECT ERROR]', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create project'
        });
    }
});

// Update project
router.put('/:id', authMiddleware, upload.any(), async (req, res) => {
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

        const coverFile = req.files?.find(f => f.fieldname === 'coverImage');
        const galleryFiles = req.files?.filter(f => f.fieldname === 'galleryImages' || f.fieldname === 'galleryFiles' || f.fieldname === 'gallery') || [];

        let coverImage = existingProject.coverImage;
        let coverImagePublicId = existingProject.coverImagePublicId;

        if (coverFile) {
            // Delete previous Cloudinary image using helper if public_id exists
            if (existingProject.coverImagePublicId) {
                try {
                    await deleteFromCloudinary(existingProject.coverImagePublicId);
                } catch (destroyErr) {
                    console.error('Failed to delete previous Cloudinary image:', destroyErr);
                }
            }

            // Upload new image to Cloudinary using helper
            const result = await uploadToCloudinary(coverFile, 'novinka/projects');
            coverImage = result.secure_url;
            coverImagePublicId = result.public_id;
        } else if (req.body.coverImage !== undefined) {
            coverImage = req.body.coverImage || null;
            if (!coverImage && existingProject.coverImagePublicId) {
                try {
                    await deleteFromCloudinary(existingProject.coverImagePublicId);
                } catch (err) {
                    console.error('Failed to delete Cloudinary image on coverImage removal:', err);
                }
                coverImagePublicId = null;
            }
        }

        let uploadedGalleryUrls = [];
        if (galleryFiles.length > 0) {
            const uploadResults = await Promise.all(
                galleryFiles.map(file => uploadToCloudinary(file, 'novinka/projects/gallery'))
            );
            uploadedGalleryUrls = uploadResults.map(r => r.secure_url);
        }

        let finalGallery = existingProject.gallery;
        if (gallery !== undefined || galleryFiles.length > 0) {
            const retainedUrls = gallery !== undefined ? parseGalleryField(gallery) : parseGalleryField(existingProject.gallery);
            finalGallery = [...retainedUrls, ...uploadedGalleryUrls];
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
                gallery: finalGallery,
                completionDate: completionDate ? new Date(completionDate) : existingProject.completionDate,
                isFeatured: isFeatured !== undefined ? (isFeatured === 'true' || isFeatured === true) : existingProject.isFeatured,
                displayOrder: displayOrder !== undefined ? parseInt(displayOrder, 10) : existingProject.displayOrder
            }
        });

        res.status(200).json({
            status: 'success',
            data: {
                project: {
                    ...project,
                    gallery: parseGalleryField(project.gallery)
                }
            },
            message: 'Project updated successfully'
        });
    } catch (error) {
        console.error('[UPDATE PROJECT ERROR]', error);
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