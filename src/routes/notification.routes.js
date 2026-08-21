const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const prisma = require('../config/prisma');

// ============================================
// GET USER NOTIFICATIONS
// ============================================
router.get('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized'
            });
        }

        const { page = 1, limit = 10, type, isRead } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 10));
        const skip = (pageNum - 1) * limitNum;
        const take = limitNum;

        // Build filter
        const where = { userId };
        if (type && typeof type === 'string' && type.trim() !== '') {
            where.type = type.trim();
        }
        if (isRead !== undefined && isRead !== null && isRead !== '') {
            where.isRead = isRead === 'true' || isRead === true;
        }

        const [notifications, total] = await Promise.all([
            prisma.notification.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take
            }),
            prisma.notification.count({ where })
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                notifications,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum) || 1
                }
            }
        });
    } catch (error) {
        console.error('Failed to fetch notifications:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch notifications',
            error: error.message || String(error)
        });
    }
});

// ============================================
// GET UNREAD COUNT (STATIC ROUTE)
// ============================================
router.get('/count', authMiddleware, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized'
            });
        }

        const count = await prisma.notification.count({
            where: {
                userId,
                isRead: false
            }
        });

        res.status(200).json({
            status: 'success',
            data: { count }
        });
    } catch (error) {
        console.error('Failed to get unread count:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get unread count',
            error: error.message || String(error)
        });
    }
});

// ============================================
// MARK ALL NOTIFICATIONS AS READ (STATIC ROUTE - BEFORE /:id)
// ============================================
router.patch('/read-all', authMiddleware, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized'
            });
        }

        const result = await prisma.notification.updateMany({
            where: {
                userId,
                isRead: false
            },
            data: { isRead: true }
        });

        res.status(200).json({
            status: 'success',
            data: { count: result.count },
            message: 'All notifications marked as read'
        });
    } catch (error) {
        console.error('Failed to mark all as read:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to mark all as read',
            error: error.message || String(error)
        });
    }
});

// ============================================
// DELETE ALL READ NOTIFICATIONS (STATIC ROUTE - BEFORE /:id)
// ============================================
router.delete('/read/all', authMiddleware, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized'
            });
        }

        const result = await prisma.notification.deleteMany({
            where: {
                userId,
                isRead: true
            }
        });

        res.status(200).json({
            status: 'success',
            data: { count: result.count },
            message: 'All read notifications deleted'
        });
    } catch (error) {
        console.error('Failed to delete read notifications:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete read notifications',
            error: error.message || String(error)
        });
    }
});

// ============================================
// MARK SINGLE NOTIFICATION AS READ (PARAMETRIC ROUTE)
// ============================================
router.patch('/:id/read', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        if (!id || id === 'read-all') {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid notification ID'
            });
        }

        const notification = await prisma.notification.findFirst({
            where: { id, userId }
        });

        if (!notification) {
            return res.status(404).json({
                status: 'error',
                message: 'Notification not found'
            });
        }

        const updated = await prisma.notification.update({
            where: { id },
            data: { isRead: true }
        });

        res.status(200).json({
            status: 'success',
            data: { notification: updated },
            message: 'Notification marked as read'
        });
    } catch (error) {
        console.error('Failed to mark notification as read:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to mark notification as read',
            error: error.message || String(error)
        });
    }
});

// ============================================
// DELETE SINGLE NOTIFICATION (PARAMETRIC ROUTE)
// ============================================
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;

        if (!id || id === 'read-all') {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid notification ID'
            });
        }

        const notification = await prisma.notification.findFirst({
            where: { id, userId }
        });

        if (!notification) {
            return res.status(404).json({
                status: 'error',
                message: 'Notification not found'
            });
        }

        await prisma.notification.delete({
            where: { id }
        });

        res.status(200).json({
            status: 'success',
            message: 'Notification deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete notification:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete notification',
            error: error.message || String(error)
        });
    }
});

// ============================================
// CREATE NOTIFICATION (Internal Use)
// ============================================
async function createNotification(userId, type, title, message, icon = null, link = null) {
    try {
        const notification = await prisma.notification.create({
            data: {
                userId,
                type,
                title,
                message,
                icon,
                link
            }
        });
        return notification;
    } catch (error) {
        console.error('Failed to create notification:', error);
        return null;
    }
}

// Export for use in other routes
module.exports = { router, createNotification };