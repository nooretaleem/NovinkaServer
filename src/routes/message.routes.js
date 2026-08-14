// src/routes/message.routes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// ============================================
// CREATE MESSAGE (Public Endpoint)
// ============================================
router.post('/', async (req, res) => {
    try {
        const { name, email, phone, subject, message } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ status: 'error', message: 'Name is required' });
        }
        if (!email || !email.trim()) {
            return res.status(400).json({ status: 'error', message: 'Email address is required' });
        }
        if (!message || !message.trim()) {
            return res.status(400).json({ status: 'error', message: 'Message is required' });
        }

        const newMessage = await prisma.message.create({
            data: {
                name: name.trim(),
                email: email.trim().toLowerCase(),
                phone: phone ? phone.trim() : null,
                subject: (subject && subject.trim()) ? subject.trim() : 'General Inquiry',
                message: message.trim(),
                status: 'UNREAD'
            }
        });

        // Automatically create admin notification in the database
        try {
            const systemUsers = await prisma.user.findMany({
                select: { id: true }
            });

            if (systemUsers && systemUsers.length > 0) {
                const notificationsData = systemUsers.map(u => ({
                    userId: u.id,
                    type: 'MESSAGE',
                    title: 'New Contact Message',
                    message: `${newMessage.name} sent a new enquiry regarding "${newMessage.subject}"`,
                    icon: 'fa-envelope',
                    link: '/messages',
                    isRead: false
                }));

                await prisma.notification.createMany({
                    data: notificationsData
                });
            }
        } catch (notifError) {
            console.error('Failed to create notification for new message:', notifError);
            // Non-blocking for client message submission response
        }

        res.status(201).json({
            status: 'success',
            message: 'Your message has been sent successfully!',
            data: { message: newMessage }
        });
    } catch (error) {
        console.error('Failed to create message:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to send message. Please try again.'
        });
    }
});

// ============================================
// GET ALL MESSAGES
// ============================================
router.get('/', authMiddleware, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            isArchived,
            search,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        // Build filter
        const where = {};

        // Filter by status
        if (status) {
            where.status = status;
        }

        // Filter by archived state
        if (isArchived !== undefined) {
            where.isArchived = isArchived === 'true';
        }

        // Search filter
        if (search) {
            where.OR = [
                { name: { contains: search } },
                { email: { contains: search } },
                { phone: { contains: search } },
                { subject: { contains: search } }
            ];
        }

        // Sorting
        const orderBy = {};
        orderBy[sortBy] = sortOrder;

        const [messages, total] = await Promise.all([
            prisma.message.findMany({
                where,
                orderBy,
                skip,
                take
            }),
            prisma.message.count({ where })
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                messages,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('Failed to fetch messages:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch messages'
        });
    }
});

// ============================================
// GET SINGLE MESSAGE
// ============================================
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const message = await prisma.message.findUnique({
            where: { id }
        });

        if (!message) {
            return res.status(404).json({
                status: 'error',
                message: 'Message not found'
            });
        }

        // Auto-mark as read if UNREAD
        if (message.status === 'UNREAD') {
            await prisma.message.update({
                where: { id },
                data: { status: 'READ' }
            });
            message.status = 'READ';
        }

        res.status(200).json({
            status: 'success',
            data: { message }
        });
    } catch (error) {
        console.error('Failed to fetch message:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch message'
        });
    }
});

// ============================================
// UPDATE MESSAGE
// ============================================
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, isArchived } = req.body;

        const existingMessage = await prisma.message.findUnique({
            where: { id }
        });

        if (!existingMessage) {
            return res.status(404).json({
                status: 'error',
                message: 'Message not found'
            });
        }

        const updatedMessage = await prisma.message.update({
            where: { id },
            data: {
                status: status || existingMessage.status,
                isArchived: isArchived !== undefined ? isArchived : existingMessage.isArchived
            }
        });

        res.status(200).json({
            status: 'success',
            data: { message: updatedMessage },
            message: 'Message updated successfully'
        });
    } catch (error) {
        console.error('Failed to update message:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update message'
        });
    }
});

// ============================================
// MARK AS READ
// ============================================
router.patch('/:id/read', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const message = await prisma.message.findUnique({
            where: { id }
        });

        if (!message) {
            return res.status(404).json({
                status: 'error',
                message: 'Message not found'
            });
        }

        const updatedMessage = await prisma.message.update({
            where: { id },
            data: { status: 'READ' }
        });

        res.status(200).json({
            status: 'success',
            data: { message: updatedMessage },
            message: 'Message marked as read'
        });
    } catch (error) {
        console.error('Failed to mark message as read:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to mark message as read'
        });
    }
});

// ============================================
// MARK AS UNREAD
// ============================================
router.patch('/:id/unread', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const message = await prisma.message.findUnique({
            where: { id }
        });

        if (!message) {
            return res.status(404).json({
                status: 'error',
                message: 'Message not found'
            });
        }

        const updatedMessage = await prisma.message.update({
            where: { id },
            data: { status: 'UNREAD' }
        });

        res.status(200).json({
            status: 'success',
            data: { message: updatedMessage },
            message: 'Message marked as unread'
        });
    } catch (error) {
        console.error('Failed to mark message as unread:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to mark message as unread'
        });
    }
});

// ============================================
// ARCHIVE MESSAGE
// ============================================
router.patch('/:id/archive', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const message = await prisma.message.findUnique({
            where: { id }
        });

        if (!message) {
            return res.status(404).json({
                status: 'error',
                message: 'Message not found'
            });
        }

        const updatedMessage = await prisma.message.update({
            where: { id },
            data: { isArchived: true }
        });

        res.status(200).json({
            status: 'success',
            data: { message: updatedMessage },
            message: 'Message archived successfully'
        });
    } catch (error) {
        console.error('Failed to archive message:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to archive message'
        });
    }
});

// ============================================
// UNARCHIVE MESSAGE
// ============================================
router.patch('/:id/unarchive', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const message = await prisma.message.findUnique({
            where: { id }
        });

        if (!message) {
            return res.status(404).json({
                status: 'error',
                message: 'Message not found'
            });
        }

        const updatedMessage = await prisma.message.update({
            where: { id },
            data: { isArchived: false }
        });

        res.status(200).json({
            status: 'success',
            data: { message: updatedMessage },
            message: 'Message unarchived successfully'
        });
    } catch (error) {
        console.error('Failed to unarchive message:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to unarchive message'
        });
    }
});

// ============================================
// DELETE MESSAGE
// ============================================
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const message = await prisma.message.findUnique({
            where: { id }
        });

        if (!message) {
            return res.status(404).json({
                status: 'error',
                message: 'Message not found'
            });
        }

        await prisma.message.delete({
            where: { id }
        });

        res.status(200).json({
            status: 'success',
            message: 'Message deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete message:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete message'
        });
    }
});

// ============================================
// GET MESSAGE SUMMARY
// ============================================
router.get('/summary/stats', authMiddleware, async (req, res) => {
    try {
        const [total, unread, read, archived] = await Promise.all([
            prisma.message.count(),
            prisma.message.count({ where: { status: 'UNREAD' } }),
            prisma.message.count({ where: { status: 'READ' } }),
            prisma.message.count({ where: { isArchived: true } })
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                total,
                unread,
                read,
                archived
            }
        });
    } catch (error) {
        console.error('Failed to get message summary:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get message summary'
        });
    }
});

module.exports = router;