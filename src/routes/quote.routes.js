// src/routes/quote.routes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Valid QuoteStatus enum values
const VALID_STATUSES = ['NEW', 'REVIEWING', 'QUOTED', 'APPROVED', 'REJECTED'];

// ============================================
// GET ALL QUOTES
// ============================================
router.get('/', authMiddleware, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            status,
            projectType,
            contractType,
            search,
            dateFrom,
            dateTo
        } = req.query;

        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 10));
        const skip = (pageNum - 1) * limitNum;
        const take = limitNum;

        // Build filter
        const where = {};

        if (status && typeof status === 'string' && VALID_STATUSES.includes(status.toUpperCase())) {
            where.status = status.toUpperCase();
        }

        if (projectType && typeof projectType === 'string' && projectType.trim() !== '') {
            where.projectType = projectType.trim();
        }

        if (contractType && typeof contractType === 'string' && contractType.trim() !== '') {
            where.contractType = contractType.trim();
        }

        if (search && typeof search === 'string' && search.trim() !== '' && search !== '[object Object]') {
            const searchTerm = search.trim();
            where.OR = [
                { customerName: { contains: searchTerm } },
                { email: { contains: searchTerm } },
                { phone: { contains: searchTerm } },
                { city: { contains: searchTerm } }
            ];
        }

        if (dateFrom || dateTo) {
            const createdAtFilter = {};
            if (dateFrom && !isNaN(Date.parse(dateFrom))) {
                createdAtFilter.gte = new Date(dateFrom);
            }
            if (dateTo && !isNaN(Date.parse(dateTo))) {
                createdAtFilter.lte = new Date(dateTo + 'T23:59:59.999Z');
            }
            if (Object.keys(createdAtFilter).length > 0) {
                where.createdAt = createdAtFilter;
            }
        }

        const [quotes, total] = await Promise.all([
            prisma.quote.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take
            }),
            prisma.quote.count({ where })
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                quotes,
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total,
                    pages: Math.ceil(total / limitNum) || 1
                }
            }
        });
    } catch (error) {
        console.error('Failed to fetch quotes:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch quotes',
            error: error.message || String(error)
        });
    }
});

// ============================================
// GET QUOTE SUMMARY (MUST BE BEFORE /:id)
// ============================================
router.get('/summary/stats', authMiddleware, async (req, res) => {
    try {
        const [total, statusCountsRaw] = await Promise.all([
            prisma.quote.count(),
            prisma.quote.groupBy({
                by: ['status'],
                _count: {
                    _all: true
                }
            })
        ]);

        const statusCounts = {
            NEW: 0,
            REVIEWING: 0,
            QUOTED: 0,
            APPROVED: 0,
            REJECTED: 0
        };

        if (Array.isArray(statusCountsRaw)) {
            statusCountsRaw.forEach(item => {
                if (item.status && statusCounts.hasOwnProperty(item.status)) {
                    const countVal = typeof item._count === 'number'
                        ? item._count
                        : (item._count?._all || 0);
                    statusCounts[item.status] = countVal;
                }
            });
        }

        res.status(200).json({
            status: 'success',
            data: {
                total,
                statusCounts
            }
        });
    } catch (error) {
        console.error('Failed to get quote summary:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get quote summary',
            error: error.message || String(error)
        });
    }
});

// ============================================
// GET SINGLE QUOTE
// ============================================
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        if (!id || id === 'summary') {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid quote ID'
            });
        }

        const quote = await prisma.quote.findUnique({
            where: { id }
        });

        if (!quote) {
            return res.status(404).json({
                status: 'error',
                message: 'Quote not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: { quote }
        });
    } catch (error) {
        console.error('Failed to fetch quote:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch quote',
            error: error.message || String(error)
        });
    }
});

// ============================================
// UPDATE QUOTE STATUS
// ============================================
router.patch('/:id/status', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminNotes, quotedAmount } = req.body;

        const quote = await prisma.quote.findUnique({
            where: { id }
        });

        if (!quote) {
            return res.status(404).json({
                status: 'error',
                message: 'Quote not found'
            });
        }

        const updateData = {};
        if (status && VALID_STATUSES.includes(status.toUpperCase())) {
            updateData.status = status.toUpperCase();
            if (status.toUpperCase() === 'QUOTED') {
                updateData.quotationSent = true;
                if (!quote.quotationSentAt) {
                    updateData.quotationSentAt = new Date();
                }
            }
        }
        if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
        if (quotedAmount !== undefined) updateData.quotedAmount = parseFloat(quotedAmount) || 0;
        updateData.viewedAt = new Date();

        const updatedQuote = await prisma.quote.update({
            where: { id },
            data: updateData
        });

        res.status(200).json({
            status: 'success',
            data: { quote: updatedQuote },
            message: 'Quote updated successfully'
        });
    } catch (error) {
        console.error('Failed to update quote status:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update quote status',
            error: error.message || String(error)
        });
    }
});

// ============================================
// UPDATE QUOTE (Full Update)
// ============================================
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            status,
            adminNotes,
            quotedAmount,
            quotationSent
        } = req.body;

        const quote = await prisma.quote.findUnique({
            where: { id }
        });

        if (!quote) {
            return res.status(404).json({
                status: 'error',
                message: 'Quote not found'
            });
        }

        const updateData = {};

        if (status && VALID_STATUSES.includes(status.toUpperCase())) {
            updateData.status = status.toUpperCase();
        }
        if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
        if (quotedAmount !== undefined && quotedAmount !== null) {
            updateData.quotedAmount = parseFloat(quotedAmount) || 0;
        }
        if (quotationSent !== undefined) {
            updateData.quotationSent = Boolean(quotationSent);
            if (quotationSent && !quote.quotationSentAt) {
                updateData.quotationSentAt = new Date();
            }
        }
        updateData.viewedAt = new Date();

        const updatedQuote = await prisma.quote.update({
            where: { id },
            data: updateData
        });

        res.status(200).json({
            status: 'success',
            data: { quote: updatedQuote },
            message: 'Quote updated successfully'
        });
    } catch (error) {
        console.error('Failed to update quote:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update quote',
            error: error.message || String(error)
        });
    }
});

// ============================================
// DELETE QUOTE
// ============================================
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const quote = await prisma.quote.findUnique({
            where: { id }
        });

        if (!quote) {
            return res.status(404).json({
                status: 'error',
                message: 'Quote not found'
            });
        }

        await prisma.quote.delete({
            where: { id }
        });

        res.status(200).json({
            status: 'success',
            message: 'Quote deleted successfully'
        });
    } catch (error) {
        console.error('Failed to delete quote:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete quote',
            error: error.message || String(error)
        });
    }
});

module.exports = router;