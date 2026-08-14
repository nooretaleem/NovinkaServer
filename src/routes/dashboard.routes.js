const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Safe model reference for FAQ (casing compatibility: fAQ / faq / FAQ)
const faqModel = prisma.fAQ || prisma.faq || prisma.FAQ;

// ============================================
// GET AGGREGATED DASHBOARD DATA
// ============================================
const getDashboardData = async (req, res) => {
    try {
        const safeCount = (model, where) => {
            if (!model) return Promise.resolve(0);
            return where ? model.count({ where }).catch(() => 0) : model.count().catch(() => 0);
        };

        const safeFindMany = (model, options) => {
            if (!model) return Promise.resolve([]);
            return model.findMany(options).catch(() => []);
        };

        const [
            totalProjects,
            featuredProjects,
            totalServices,
            totalBlogs,
            totalQuotes,
            newQuotes,
            reviewingQuotes,
            approvedQuotes,
            rejectedQuotes,
            quotedQuotes,
            totalMessages,
            unreadMessages,
            readMessages,
            archivedMessages,
            totalFaqs,
            totalUsers,
            recentProjects,
            recentQuotes,
            recentMessages,
            recentBlogs
        ] = await Promise.all([
            safeCount(prisma.project),
            safeCount(prisma.project, { isFeatured: true }),
            safeCount(prisma.service),
            safeCount(prisma.blog),
            safeCount(prisma.quote),
            safeCount(prisma.quote, { status: 'NEW' }),
            safeCount(prisma.quote, { status: 'REVIEWING' }),
            safeCount(prisma.quote, { status: 'APPROVED' }),
            safeCount(prisma.quote, { status: 'REJECTED' }),
            safeCount(prisma.quote, { status: 'QUOTED' }),
            safeCount(prisma.message),
            safeCount(prisma.message, { status: 'UNREAD' }),
            safeCount(prisma.message, { status: 'READ' }),
            safeCount(prisma.message, { isArchived: true }),
            safeCount(faqModel),
            safeCount(prisma.user),
            safeFindMany(prisma.project, {
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    title: true,
                    location: true,
                    projectType: true,
                    isFeatured: true,
                    createdAt: true
                }
            }),
            safeFindMany(prisma.quote, {
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    customerName: true,
                    email: true,
                    city: true,
                    projectType: true,
                    status: true,
                    createdAt: true
                }
            }),
            safeFindMany(prisma.message, {
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    name: true,
                    email: true,
                    subject: true,
                    status: true,
                    isArchived: true,
                    createdAt: true
                }
            }),
            safeFindMany(prisma.blog, {
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    title: true,
                    slug: true,
                    isPublished: true,
                    createdAt: true
                }
            })
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                stats: {
                    totalProjects,
                    featuredProjects,
                    totalServices,
                    totalBlogs,
                    totalQuotes,
                    newQuotes,
                    reviewingQuotes,
                    approvedQuotes,
                    rejectedQuotes,
                    totalMessages,
                    unreadMessages,
                    archivedMessages,
                    totalFaqs,
                    totalUsers
                },
                quoteStatusCounts: {
                    NEW: newQuotes,
                    REVIEWING: reviewingQuotes,
                    QUOTED: quotedQuotes,
                    APPROVED: approvedQuotes,
                    REJECTED: rejectedQuotes
                },
                messageStatusCounts: {
                    UNREAD: unreadMessages,
                    READ: readMessages,
                    ARCHIVED: archivedMessages
                },
                recentProjects,
                recentQuotes,
                recentMessages,
                recentBlogs
            }
        });
    } catch (error) {
        console.error('Failed to load dashboard stats:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to load dashboard data',
            error: error.message || String(error)
        });
    }
};

router.get('/dashboard', authMiddleware, getDashboardData);
router.get('/dashboard/stats', authMiddleware, getDashboardData);

// Backwards compatibility for standalone count requests
router.get('/quotes/count', authMiddleware, async (req, res) => {
    try {
        const count = await prisma.quote.count();
        res.status(200).json({ status: 'success', data: { count } });
    } catch (error) {
        res.status(200).json({ status: 'success', data: { count: 0 } });
    }
});

router.get('/messages/count', authMiddleware, async (req, res) => {
    try {
        const count = await prisma.message.count({ where: { status: 'UNREAD' } });
        res.status(200).json({ status: 'success', data: { count } });
    } catch (error) {
        res.status(200).json({ status: 'success', data: { count: 0 } });
    }
});

module.exports = router;