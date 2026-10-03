const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth.middleware');

const router = express.Router();
const prisma = new PrismaClient();

// Utility: Extract YouTube Video ID from various formats
function extractYoutubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

// GET /api/wadanza-videos
// List all videos (sorted by displayOrder then createdAt desc)
router.get('/', async (req, res) => {
    try {
        const videos = await prisma.wadanzaVideo.findMany({
            orderBy: [
                { displayOrder: 'asc' },
                { createdAt: 'desc' }
            ]
        });
        res.json({ status: 'success', data: { videos } });
    } catch (error) {
        console.error('Error fetching wadanza videos:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch videos' });
    }
});

// GET /api/wadanza-videos/active
// Public endpoint returning only the single active video for the hero
router.get('/active', async (req, res) => {
    try {
        const video = await prisma.wadanzaVideo.findFirst({
            where: { isActive: true }
        });
        if (!video) {
            return res.status(404).json({ status: 'error', message: 'No active video found' });
        }
        res.json({ status: 'success', data: { video } });
    } catch (error) {
        console.error('Error fetching active wadanza video:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch active video' });
    }
});

// POST /api/wadanza-videos
// Admin-only, creates a new video
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { title, youtubeUrl, thumbnailUrl, displayOrder } = req.body;
        
        if (!title || !youtubeUrl) {
            return res.status(400).json({ status: 'error', message: 'Title and YouTube URL are required' });
        }

        const youtubeVideoId = extractYoutubeId(youtubeUrl);
        if (!youtubeVideoId) {
            return res.status(400).json({ status: 'error', message: 'Invalid YouTube URL' });
        }

        const video = await prisma.wadanzaVideo.create({
            data: {
                title,
                youtubeUrl,
                youtubeVideoId,
                thumbnailUrl: thumbnailUrl || null,
                displayOrder: displayOrder ? parseInt(displayOrder) : 0
            }
        });

        res.status(201).json({ status: 'success', data: { video } });
    } catch (error) {
        console.error('Error creating wadanza video:', error);
        res.status(500).json({ status: 'error', message: 'Failed to create video' });
    }
});

// PATCH /api/wadanza-videos/:id
// Admin-only, partial update
router.patch('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { title, youtubeUrl, thumbnailUrl, displayOrder } = req.body;

        const updateData = {};
        if (title !== undefined) updateData.title = title;
        if (thumbnailUrl !== undefined) updateData.thumbnailUrl = thumbnailUrl || null;
        if (displayOrder !== undefined) updateData.displayOrder = parseInt(displayOrder);

        if (youtubeUrl) {
            const youtubeVideoId = extractYoutubeId(youtubeUrl);
            if (!youtubeVideoId) {
                return res.status(400).json({ status: 'error', message: 'Invalid YouTube URL' });
            }
            updateData.youtubeUrl = youtubeUrl;
            updateData.youtubeVideoId = youtubeVideoId;
        }

        const video = await prisma.wadanzaVideo.update({
            where: { id },
            data: updateData
        });

        res.json({ status: 'success', data: { video } });
    } catch (error) {
        console.error('Error updating wadanza video:', error);
        res.status(500).json({ status: 'error', message: 'Failed to update video' });
    }
});

// PATCH /api/wadanza-videos/:id/activate
// Admin-only, sets this video as active and atomically sets all others to isActive: false
router.patch('/:id/activate', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.$transaction([
            prisma.wadanzaVideo.updateMany({
                where: { isActive: true },
                data: { isActive: false }
            }),
            prisma.wadanzaVideo.update({
                where: { id },
                data: { isActive: true }
            })
        ]);

        res.json({ status: 'success', message: 'Video activated successfully' });
    } catch (error) {
        console.error('Error activating wadanza video:', error);
        res.status(500).json({ status: 'error', message: 'Failed to activate video' });
    }
});

// DELETE /api/wadanza-videos/:id
// Admin-only, hard delete, promote next-highest displayOrder if active
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const videoToDelete = await prisma.wadanzaVideo.findUnique({ where: { id } });
        if (!videoToDelete) {
            return res.status(404).json({ status: 'error', message: 'Video not found' });
        }

        await prisma.wadanzaVideo.delete({ where: { id } });

        // If the deleted video was active, try to promote another one
        if (videoToDelete.isActive) {
            const nextVideo = await prisma.wadanzaVideo.findFirst({
                orderBy: [
                    { displayOrder: 'asc' },
                    { createdAt: 'desc' }
                ]
            });

            if (nextVideo) {
                await prisma.wadanzaVideo.update({
                    where: { id: nextVideo.id },
                    data: { isActive: true }
                });
            }
        }

        res.json({ status: 'success', message: 'Video deleted successfully' });
    } catch (error) {
        console.error('Error deleting wadanza video:', error);
        res.status(500).json({ status: 'error', message: 'Failed to delete video' });
    }
});

module.exports = router;
