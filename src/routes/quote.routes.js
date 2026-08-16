// src/routes/quote.routes.js
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const { PrismaClient } = require('@prisma/client');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const prisma = new PrismaClient();

// Helper to format currency in PKR
function formatPkr(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return 'N/A';
    return 'PKR ' + Number(amount).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

// Valid QuoteStatus enum values
const VALID_STATUSES = ['NEW', 'REVIEWING', 'QUOTED', 'APPROVED', 'REJECTED'];

// ============================================
// CREATE QUOTE REQUEST (Public Endpoint)
// ============================================
router.post('/', async (req, res) => {
    try {
        const {
            customerName,
            email,
            phone,
            city,
            projectType,
            contractType,
            plotSize,
            coveredArea,
            estimatedCost,
            estimatorDetails,
            message
        } = req.body;

        // Validation - Required String Fields
        if (!customerName || typeof customerName !== 'string' || !customerName.trim()) {
            return res.status(400).json({ status: 'error', message: 'Customer name is required' });
        }

        if (!email || typeof email !== 'string' || !email.trim()) {
            return res.status(400).json({ status: 'error', message: 'Email address is required' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            return res.status(400).json({ status: 'error', message: 'Invalid email address format' });
        }

        if (!phone || typeof phone !== 'string' || !phone.trim()) {
            return res.status(400).json({ status: 'error', message: 'Phone number is required' });
        }

        if (!city || typeof city !== 'string' || !city.trim()) {
            return res.status(400).json({ status: 'error', message: 'City is required' });
        }

        if (!projectType || typeof projectType !== 'string' || !projectType.trim()) {
            return res.status(400).json({ status: 'error', message: 'Project type is required' });
        }

        if (!contractType || typeof contractType !== 'string' || !contractType.trim()) {
            return res.status(400).json({ status: 'error', message: 'Contract type is required' });
        }

        // Validation - Required Numeric Fields
        const numPlotSize = parseFloat(plotSize);
        if (plotSize === undefined || plotSize === null || isNaN(numPlotSize) || numPlotSize <= 0) {
            return res.status(400).json({ status: 'error', message: 'Plot size must be a valid positive number' });
        }

        const numCoveredArea = parseFloat(coveredArea);
        if (coveredArea === undefined || coveredArea === null || isNaN(numCoveredArea) || numCoveredArea <= 0) {
            return res.status(400).json({ status: 'error', message: 'Covered area must be a valid positive number' });
        }

        // Validation - Optional Numeric Fields
        let parsedEstimatedCost = null;
        if (estimatedCost !== undefined && estimatedCost !== null && estimatedCost !== '') {
            const numEstimatedCost = parseFloat(estimatedCost);
            if (isNaN(numEstimatedCost) || numEstimatedCost < 0) {
                return res.status(400).json({ status: 'error', message: 'Estimated cost must be a valid non-negative number' });
            }
            parsedEstimatedCost = numEstimatedCost;
        }

        // Validation - Optional Estimator Details JSON
        let parsedEstimatorDetails = null;
        if (estimatorDetails !== undefined && estimatorDetails !== null) {
            if (typeof estimatorDetails !== 'object' || Array.isArray(estimatorDetails)) {
                return res.status(400).json({ status: 'error', message: 'Estimator details must be a valid JSON object' });
            }
            parsedEstimatorDetails = estimatorDetails;
        }

        // Strict Security / Mass Assignment Control
        // Explicitly create quote with status: 'NEW' and only allowed customer fields
        const newQuote = await prisma.quote.create({
            data: {
                customerName: customerName.trim(),
                email: email.trim().toLowerCase(),
                phone: phone.trim(),
                city: city.trim(),
                projectType: projectType.trim(),
                contractType: contractType.trim(),
                plotSize: numPlotSize,
                coveredArea: numCoveredArea,
                estimatedCost: parsedEstimatedCost,
                estimatorDetails: parsedEstimatorDetails,
                message: message && typeof message === 'string' && message.trim() ? message.trim() : null,
                status: 'NEW'
            }
        });

        // Create Admin Notification (Non-blocking)
        try {
            const systemUsers = await prisma.user.findMany({
                select: { id: true }
            });

            if (systemUsers && systemUsers.length > 0) {
                const notificationsData = systemUsers.map(u => ({
                    userId: u.id,
                    type: 'QUOTE',
                    title: 'New Quote Request',
                    message: `${newQuote.customerName} requested a quote for ${newQuote.projectType} in ${newQuote.city}`,
                    icon: 'fa-file-invoice-dollar',
                    link: '/quotes',
                    isRead: false
                }));

                await prisma.notification.createMany({
                    data: notificationsData
                });
            }
        } catch (notifError) {
            console.error('Failed to create notification for new quote:', notifError);
        }

        return res.status(201).json({
            success: true,
            message: 'Quote request submitted successfully',
            data: {
                id: newQuote.id
            }
        });
    } catch (error) {
        console.error('Failed to create quote request:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to submit quote request'
        });
    }
});

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

// Helper: Create reusable PDF buffer
function generateQuotePdfBuffer(quote) {
    return new Promise((resolve, reject) => {
        try {
            const chunks = [];
            const doc = new PDFDocument({ margin: 40, size: 'A4' });

            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const id = quote.id;

            // --- BRANDING & HEADER ---
            doc.fillColor('#0073E6').fontSize(22).font('Helvetica-Bold').text('NOVINKA CONSTRUCTIONS', { align: 'left' });
            doc.fillColor('#6B7A8C').fontSize(10).font('Helvetica').text('Engineering & Construction Services', { align: 'left' });
            doc.moveDown(0.5);

            // Header Line
            doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#0073E6').lineWidth(2).stroke();
            doc.moveDown(1);

            // Document Title
            doc.fillColor('#1A3A5C').fontSize(15).font('Helvetica-Bold').text('OFFICIAL CONSTRUCTION QUOTATION', { align: 'center' });
            doc.moveDown(0.8);

            // Reference & Date Info
            const quoteDate = quote.createdAt ? new Date(quote.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : new Date().toLocaleDateString('en-US');
            doc.fillColor('#333333').fontSize(10);
            doc.font('Helvetica-Bold').text('Quotation Ref: ', { continued: true }).font('Helvetica').text(`NOV-QUOTE-${id}`);
            doc.font('Helvetica-Bold').text('Date: ', { continued: true }).font('Helvetica').text(quoteDate);
            doc.font('Helvetica-Bold').text('Status: ', { continued: true }).font('Helvetica').text(quote.status || 'NEW');
            doc.moveDown(1);

            // --- CUSTOMER INFORMATION ---
            doc.fillColor('#0073E6').fontSize(12).font('Helvetica-Bold').text('CUSTOMER INFORMATION');
            doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E2E8F0').lineWidth(1).stroke();
            doc.moveDown(0.5);

            doc.fillColor('#333333').fontSize(10);
            doc.font('Helvetica-Bold').text('Customer Name: ', { continued: true }).font('Helvetica').text(quote.customerName || 'N/A');
            doc.font('Helvetica-Bold').text('Email Address: ', { continued: true }).font('Helvetica').text(quote.email || 'N/A');
            doc.font('Helvetica-Bold').text('Phone Number: ', { continued: true }).font('Helvetica').text(quote.phone || 'N/A');
            doc.font('Helvetica-Bold').text('City / Location: ', { continued: true }).font('Helvetica').text(quote.city || 'N/A');
            doc.moveDown(1);

            // --- PROJECT SPECIFICATIONS ---
            doc.fillColor('#0073E6').fontSize(12).font('Helvetica-Bold').text('PROJECT SPECIFICATIONS');
            doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E2E8F0').lineWidth(1).stroke();
            doc.moveDown(0.5);

            doc.fillColor('#333333').fontSize(10);
            doc.font('Helvetica-Bold').text('Project Type: ', { continued: true }).font('Helvetica').text(quote.projectType || 'N/A');
            doc.font('Helvetica-Bold').text('Contract Type: ', { continued: true }).font('Helvetica').text(quote.contractType || 'N/A');
            doc.font('Helvetica-Bold').text('Plot Size: ', { continued: true }).font('Helvetica').text(quote.plotSize ? `${quote.plotSize} sq. ft.` : 'N/A');
            doc.font('Helvetica-Bold').text('Covered Area: ', { continued: true }).font('Helvetica').text(quote.coveredArea ? `${quote.coveredArea} sq. ft.` : 'N/A');
            doc.moveDown(1);

            // --- ESTIMATOR BREAKDOWN ---
            const details = quote.estimatorDetails;
            if (details && typeof details === 'object') {
                doc.fillColor('#0073E6').fontSize(12).font('Helvetica-Bold').text('ESTIMATOR BREAKDOWN & SCOPE');
                doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E2E8F0').lineWidth(1).stroke();
                doc.moveDown(0.5);

                doc.fillColor('#333333').fontSize(10);
                if (details.floors !== undefined) doc.font('Helvetica-Bold').text('Floors: ', { continued: true }).font('Helvetica').text(String(details.floors));
                if (details.bedrooms !== undefined) doc.font('Helvetica-Bold').text('Bedrooms: ', { continued: true }).font('Helvetica').text(String(details.bedrooms));
                if (details.bathrooms !== undefined) doc.font('Helvetica-Bold').text('Bathrooms: ', { continued: true }).font('Helvetica').text(String(details.bathrooms));
                if (details.kitchens !== undefined) doc.font('Helvetica-Bold').text('Kitchens: ', { continued: true }).font('Helvetica').text(String(details.kitchens));
                if (details.drawingRoom !== undefined) doc.font('Helvetica-Bold').text('Drawing Room: ', { continued: true }).font('Helvetica').text(details.drawingRoom ? 'Included' : 'None');
                if (details.tvLounge !== undefined) doc.font('Helvetica-Bold').text('TV Lounge: ', { continued: true }).font('Helvetica').text(details.tvLounge ? 'Included' : 'None');
                if (details.carPorch !== undefined) doc.font('Helvetica-Bold').text('Car Porch: ', { continued: true }).font('Helvetica').text(details.carPorch ? 'Included' : 'None');
                if (details.basement !== undefined) doc.font('Helvetica-Bold').text('Basement: ', { continued: true }).font('Helvetica').text(details.basement ? 'Included' : 'None');
                if (details.materialQuality) doc.font('Helvetica-Bold').text('Material Quality: ', { continued: true }).font('Helvetica').text(String(details.materialQuality));
                if (details.timeline) doc.font('Helvetica-Bold').text('Estimated Duration: ', { continued: true }).font('Helvetica').text(`${details.timeline} months`);
                doc.moveDown(1);
            }

            // --- COST & QUOTATION SUMMARY ---
            doc.fillColor('#0073E6').fontSize(12).font('Helvetica-Bold').text('COST & QUOTATION SUMMARY');
            doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E2E8F0').lineWidth(1).stroke();
            doc.moveDown(0.5);

            doc.fillColor('#333333').fontSize(10);
            doc.font('Helvetica-Bold').text('Estimated Construction Cost: ', { continued: true }).font('Helvetica').text(formatPkr(quote.estimatedCost));

            if (details && details.costPerSqFt) {
                doc.font('Helvetica-Bold').text('Cost per Sq. Ft.: ', { continued: true }).font('Helvetica').text(formatPkr(details.costPerSqFt));
            }
            if (details && details.labourCost) {
                doc.font('Helvetica-Bold').text('Labour Cost: ', { continued: true }).font('Helvetica').text(formatPkr(details.labourCost));
            }
            if (details && details.companyFee) {
                doc.font('Helvetica-Bold').text('Company Supervision Fee: ', { continued: true }).font('Helvetica').text(formatPkr(details.companyFee));
            }
            if (details && details.engineeringCost) {
                doc.font('Helvetica-Bold').text('Engineering & Architecture Cost: ', { continued: true }).font('Helvetica').text(formatPkr(details.engineeringCost));
            }

            doc.moveDown(0.8);

            // Highlight Box for NOVINKA Quoted Amount
            const quotedText = quote.quotedAmount !== null && quote.quotedAmount !== undefined
                ? formatPkr(quote.quotedAmount)
                : 'Quotation amount not yet finalized.';

            doc.rect(40, doc.y, 515, 34).fillAndStroke('#F8FAFC', '#0073E6');
            doc.fillColor('#1A3A5C').fontSize(11).font('Helvetica-Bold').text(`NOVINKA QUOTED AMOUNT:  ${quotedText}`, 50, doc.y - 24);
            doc.moveDown(1.5);

            // Customer Requirements (if present)
            if (quote.message) {
                doc.fillColor('#0073E6').fontSize(11).font('Helvetica-Bold').text('CUSTOMER REQUIREMENTS / NOTES');
                doc.fillColor('#555555').fontSize(9).font('Helvetica').text(quote.message);
                doc.moveDown(1);
            }

            // --- FOOTER & DISCLAIMER ---
            doc.moveTo(40, 770).lineTo(555, 770).strokeColor('#E2E8F0').lineWidth(1).stroke();
            doc.fillColor('#888888').fontSize(8).font('Helvetica').text(
                'This quotation is generated electronically by NOVINKA Constructions. For inquiries contact support@novinkaconstructions.com',
                40, 778, { align: 'center' }
            );

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

// Helper: Ensure quote has a cryptographically secure 64-char hex customer access token
async function ensureCustomerAccessToken(quote) {
    if (quote.customerAccessToken) {
        return quote.customerAccessToken;
    }
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days validity
    const updated = await prisma.quote.update({
        where: { id: quote.id },
        data: {
            customerAccessToken: token,
            customerAccessTokenCreatedAt: new Date(),
            customerAccessTokenExpiresAt: expiresAt,
            customerAccessTokenRevoked: false
        }
    });
    return updated.customerAccessToken;
}

// Helper: Validate Customer Access Token Expiration & Revocation Lifecycle
function validateCustomerToken(quote) {
    if (!quote) {
        return { valid: false, status: 404, message: 'Quotation not found.' };
    }
    if (quote.customerAccessTokenRevoked) {
        return { valid: false, status: 403, message: 'This quotation access link has been revoked.' };
    }
    if (quote.customerAccessTokenExpiresAt && new Date() > new Date(quote.customerAccessTokenExpiresAt)) {
        return { valid: false, status: 403, message: 'This quotation access link has expired.' };
    }
    return { valid: true };
}

// Helper: Send Quotation Email via Nodemailer
async function sendQuotationEmail(quote, pdfBuffer, token) {
    let transporter;
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASSWORD || process.env.SMTP_PASS
            }
        });
    } else {
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: {
                user: testAccount.user,
                pass: testAccount.pass
            }
        });
    }

    const siteUrl = process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL || 'http://localhost:5500';
    const viewUrl = `${siteUrl}/quotation.html?token=${token}`;

    const mailOptions = {
        from: process.env.EMAIL_FROM || '"NOVINKA Constructions" <quotes@novinkaconstructions.com>',
        to: quote.email,
        subject: `NOVINKA Construction — Official Quotation (Ref: NOV-QUOTE-${quote.id})`,
        text: `Dear ${quote.customerName},\n\nThank you for reaching out to NOVINKA Constructions.\n\nWe have prepared your official construction quotation for your project (${quote.projectType || 'Construction Project'}).\n\nTotal Quoted Amount: ${formatPkr(quote.quotedAmount)}\n\nView Your Quotation Online:\n${viewUrl}\n\nPlease find your detailed quotation document attached as a PDF file to this email.\n\nBest Regards,\nNOVINKA Constructions Team`,
        html: `
            <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #0073E6; padding: 20px; text-align: center; color: #fff;">
                    <h1 style="margin: 0; font-size: 24px;">NOVINKA CONSTRUCTIONS</h1>
                    <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Official Construction Quotation</p>
                </div>
                <div style="padding: 24px;">
                    <p style="font-size: 16px;">Dear <strong>${quote.customerName}</strong>,</p>
                    <p>Thank you for reaching out to NOVINKA Constructions. We are pleased to provide your official quotation for <strong>${quote.projectType || 'your construction project'}</strong>.</p>
                    <div style="background-color: #f8fafc; border-left: 4px solid #0073E6; padding: 15px; margin: 20px 0; border-radius: 4px;">
                        <p style="margin: 0; font-size: 14px; color: #64748b;">Quoted Amount:</p>
                        <p style="margin: 5px 0 0 0; font-size: 22px; font-weight: bold; color: #1a3a5c;">${formatPkr(quote.quotedAmount)}</p>
                    </div>
                    <p style="margin: 20px 0;">
                        <a href="${viewUrl}" target="_blank" style="background-color: #0073E6; color: #ffffff; padding: 12px 22px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">📄 View Your Quotation Online</a>
                    </p>
                    <p>Your complete breakdown and scope of work are also attached to this email in PDF format (<strong>NOVINKA-Quotation-${quote.id}.pdf</strong>).</p>
                    <p>If you have any questions, please feel free to reach out to our team.</p>
                    <p style="margin-top: 30px; font-size: 14px; color: #64748b;">Best Regards,<br><strong style="color: #333;">NOVINKA Constructions Team</strong></p>
                </div>
            </div>
        `,
        attachments: [
            {
                filename: `NOVINKA-Quotation-${quote.id}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }
        ]
    };

    return await transporter.sendMail(mailOptions);
}

// ============================================
// GENERATE QUOTATION PDF (GET /:id/pdf)
// ============================================
router.get('/:id/pdf', authMiddleware, async (req, res) => {
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

        const pdfBuffer = await generateQuotePdfBuffer(quote);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="NOVINKA-Quotation-${id}.pdf"`);
        res.status(200).send(pdfBuffer);
    } catch (error) {
        console.error('Failed to generate PDF quotation:', error);
        if (!res.headersSent) {
            res.status(500).json({
                status: 'error',
                message: 'Failed to generate PDF quotation',
                error: error.message || String(error)
            });
        }
    }
});

// ============================================
// CUSTOMER READ-ONLY QUOTATION VIEW (GET /customer/quotes/:token)
// ============================================
router.get('/customer/quotes/:token', async (req, res) => {
    try {
        const { token } = req.params;

        if (!token || typeof token !== 'string' || token.trim().length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Invalid quotation token.'
            });
        }

        const quote = await prisma.quote.findUnique({
            where: { customerAccessToken: token }
        });

        const tokenCheck = validateCustomerToken(quote);
        if (!tokenCheck.valid) {
            return res.status(tokenCheck.status).json({
                status: 'error',
                message: tokenCheck.message
            });
        }

        if (quote.status !== 'QUOTED' && quote.status !== 'APPROVED' && quote.status !== 'REJECTED') {
            return res.status(403).json({
                status: 'error',
                message: 'This quotation is not yet available for customer viewing.'
            });
        }

        // Return customer-safe payload (STRICTLY EXCLUDE adminNotes)
        const customerSafeQuote = {
            id: quote.id,
            customerName: quote.customerName,
            email: quote.email,
            phone: quote.phone,
            city: quote.city,
            projectType: quote.projectType,
            contractType: quote.contractType,
            plotSize: quote.plotSize,
            coveredArea: quote.coveredArea,
            estimatedCost: quote.estimatedCost,
            quotedAmount: quote.quotedAmount,
            status: quote.status,
            estimatorDetails: quote.estimatorDetails,
            message: quote.message,
            quotationSent: quote.quotationSent,
            quotationSentAt: quote.quotationSentAt,
            customerResponse: quote.customerResponse,
            customerResponseAt: quote.customerResponseAt,
            customerRejectionReason: quote.customerRejectionReason,
            createdAt: quote.createdAt,
            updatedAt: quote.updatedAt
        };

        res.status(200).json({
            status: 'success',
            data: { quote: customerSafeQuote }
        });
    } catch (error) {
        console.error('Failed to retrieve customer quotation:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to retrieve customer quotation',
            error: error.message || String(error)
        });
    }
});

// ============================================
// CUSTOMER QUOTATION ACCEPTANCE (POST /customer/quotes/:token/accept)
// ============================================
router.post('/customer/quotes/:token/accept', async (req, res) => {
    try {
        const { token } = req.params;

        if (!token || typeof token !== 'string' || token.trim().length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Invalid quotation token.'
            });
        }

        const quote = await prisma.quote.findUnique({
            where: { customerAccessToken: token }
        });

        const tokenCheck = validateCustomerToken(quote);
        if (!tokenCheck.valid) {
            return res.status(tokenCheck.status).json({
                status: 'error',
                message: tokenCheck.message
            });
        }

        if (quote.status === 'APPROVED' || quote.status === 'REJECTED') {
            return res.status(400).json({
                status: 'error',
                message: 'This quotation has already been accepted or rejected.'
            });
        }

        if (quote.status !== 'QUOTED') {
            return res.status(403).json({
                status: 'error',
                message: 'This quotation is not available for customer response.'
            });
        }

        // Concurrency / double response protection using atomic transition
        const updateCount = await prisma.quote.updateMany({
            where: { id: quote.id, status: 'QUOTED' },
            data: {
                status: 'APPROVED',
                customerResponse: 'ACCEPTED',
                customerResponseAt: new Date()
            }
        });

        if (updateCount.count === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'This quotation has already been accepted or rejected.'
            });
        }

        const updatedQuote = await prisma.quote.findUnique({
            where: { id: quote.id }
        });

        const customerSafeQuote = {
            id: updatedQuote.id,
            customerName: updatedQuote.customerName,
            email: updatedQuote.email,
            phone: updatedQuote.phone,
            city: updatedQuote.city,
            projectType: updatedQuote.projectType,
            contractType: updatedQuote.contractType,
            plotSize: updatedQuote.plotSize,
            coveredArea: updatedQuote.coveredArea,
            estimatedCost: updatedQuote.estimatedCost,
            quotedAmount: updatedQuote.quotedAmount,
            status: updatedQuote.status,
            estimatorDetails: updatedQuote.estimatorDetails,
            message: updatedQuote.message,
            customerResponse: updatedQuote.customerResponse,
            customerResponseAt: updatedQuote.customerResponseAt,
            customerRejectionReason: updatedQuote.customerRejectionReason,
            createdAt: updatedQuote.createdAt,
            updatedAt: updatedQuote.updatedAt
        };

        res.status(200).json({
            status: 'success',
            message: 'Quotation accepted successfully',
            data: { quote: customerSafeQuote }
        });
    } catch (error) {
        console.error('Failed to accept customer quotation:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to accept quotation',
            error: error.message || String(error)
        });
    }
});

// ============================================
// CUSTOMER QUOTATION REJECTION (POST /customer/quotes/:token/reject)
// ============================================
router.post('/customer/quotes/:token/reject', async (req, res) => {
    try {
        const { token } = req.params;
        const { reason } = req.body || {};

        if (!token || typeof token !== 'string' || token.trim().length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Invalid quotation token.'
            });
        }

        // Validate rejection reason format
        let sanitizedReason = null;
        if (reason !== undefined && reason !== null) {
            if (typeof reason !== 'string') {
                return res.status(400).json({
                    status: 'error',
                    message: 'Rejection reason must be a text string.'
                });
            }
            sanitizedReason = reason.trim();
            if (sanitizedReason.length > 1000) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Rejection reason cannot exceed 1000 characters.'
                });
            }
            if (sanitizedReason.length === 0) {
                sanitizedReason = null;
            }
        }

        const quote = await prisma.quote.findUnique({
            where: { customerAccessToken: token }
        });

        const tokenCheck = validateCustomerToken(quote);
        if (!tokenCheck.valid) {
            return res.status(tokenCheck.status).json({
                status: 'error',
                message: tokenCheck.message
            });
        }

        if (quote.status === 'APPROVED' || quote.status === 'REJECTED') {
            return res.status(400).json({
                status: 'error',
                message: 'This quotation has already been accepted or rejected.'
            });
        }

        if (quote.status !== 'QUOTED') {
            return res.status(403).json({
                status: 'error',
                message: 'This quotation is not available for customer response.'
            });
        }

        // Concurrency / double response protection using atomic transition
        const updateCount = await prisma.quote.updateMany({
            where: { id: quote.id, status: 'QUOTED' },
            data: {
                status: 'REJECTED',
                customerResponse: 'REJECTED',
                customerResponseAt: new Date(),
                customerRejectionReason: sanitizedReason
            }
        });

        if (updateCount.count === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'This quotation has already been accepted or rejected.'
            });
        }

        const updatedQuote = await prisma.quote.findUnique({
            where: { id: quote.id }
        });

        const customerSafeQuote = {
            id: updatedQuote.id,
            customerName: updatedQuote.customerName,
            email: updatedQuote.email,
            phone: updatedQuote.phone,
            city: updatedQuote.city,
            projectType: updatedQuote.projectType,
            contractType: updatedQuote.contractType,
            plotSize: updatedQuote.plotSize,
            coveredArea: updatedQuote.coveredArea,
            estimatedCost: updatedQuote.estimatedCost,
            quotedAmount: updatedQuote.quotedAmount,
            status: updatedQuote.status,
            estimatorDetails: updatedQuote.estimatorDetails,
            message: updatedQuote.message,
            customerResponse: updatedQuote.customerResponse,
            customerResponseAt: updatedQuote.customerResponseAt,
            customerRejectionReason: updatedQuote.customerRejectionReason,
            createdAt: updatedQuote.createdAt,
            updatedAt: updatedQuote.updatedAt
        };

        res.status(200).json({
            status: 'success',
            message: 'Quotation rejected successfully',
            data: { quote: customerSafeQuote }
        });
    } catch (error) {
        console.error('Failed to reject customer quotation:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to reject quotation',
            error: error.message || String(error)
        });
    }
});

// ============================================
// CUSTOMER READ-ONLY QUOTATION PDF (GET /customer/quotes/:token/pdf)
// ============================================
router.get('/customer/quotes/:token/pdf', async (req, res) => {
    try {
        const { token } = req.params;

        if (!token || typeof token !== 'string' || token.trim().length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Invalid quotation token.'
            });
        }

        const quote = await prisma.quote.findUnique({
            where: { customerAccessToken: token }
        });

        const tokenCheck = validateCustomerToken(quote);
        if (!tokenCheck.valid) {
            return res.status(tokenCheck.status).json({
                status: 'error',
                message: tokenCheck.message
            });
        }

        if (quote.status !== 'QUOTED' && quote.status !== 'APPROVED' && quote.status !== 'REJECTED') {
            return res.status(403).json({
                status: 'error',
                message: 'This quotation is not yet available for customer viewing.'
            });
        }

        const pdfBuffer = await generateQuotePdfBuffer(quote);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="NOVINKA-Quotation-${quote.id}.pdf"`);
        res.status(200).send(pdfBuffer);
    } catch (error) {
        console.error('Failed to generate customer PDF quotation:', error);
        if (!res.headersSent) {
            res.status(500).json({
                status: 'error',
                message: 'Failed to generate PDF quotation',
                error: error.message || String(error)
            });
        }
    }
});

// ============================================
// SEND QUOTATION VIA EMAIL (POST /:id/send)
// ============================================
router.post('/:id/send', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Find quote
        const quote = await prisma.quote.findUnique({
            where: { id }
        });

        if (!quote) {
            return res.status(404).json({
                status: 'error',
                message: 'Quote not found'
            });
        }

        // 2. Email validation
        if (!quote.email || typeof quote.email !== 'string' || !quote.email.includes('@')) {
            return res.status(400).json({
                status: 'error',
                message: 'Customer email address is missing or invalid.'
            });
        }

        // 3. Status validation
        if (quote.status !== 'QUOTED') {
            return res.status(400).json({
                status: 'error',
                message: 'Quote status must be QUOTED before sending quotation to customer.'
            });
        }

        // 4. Quoted amount validation
        if (!quote.quotedAmount || Number(quote.quotedAmount) <= 0) {
            return res.status(400).json({
                status: 'error',
                message: 'A valid positive quoted amount is required before sending quotation.'
            });
        }

        // 5. Already sent check
        if (quote.quotationSent) {
            return res.status(400).json({
                status: 'error',
                message: 'Quotation has already been sent to customer.'
            });
        }

        // 6. Ensure secure customer access token exists
        const token = await ensureCustomerAccessToken(quote);

        // 7. Generate PDF attachment buffer
        const pdfBuffer = await generateQuotePdfBuffer(quote);

        // 8. Send email with customer access token URL
        await sendQuotationEmail(quote, pdfBuffer, token);

        // 9. Update database ONLY AFTER successful email delivery
        const updatedQuote = await prisma.quote.update({
            where: { id },
            data: {
                quotationSent: true,
                quotationSentAt: new Date()
            }
        });

        res.status(200).json({
            status: 'success',
            message: 'Quotation sent successfully',
            data: { quote: updatedQuote }
        });
    } catch (error) {
        console.error('Failed to send quotation email:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to send quotation email',
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
// UPDATE QUOTE ADMIN FIELDS (PATCH /:id & PUT /:id)
// ============================================
const handleQuoteUpdate = async (req, res) => {
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

        // 1. Status validation
        if (status !== undefined && status !== null) {
            if (typeof status !== 'string' || !VALID_STATUSES.includes(status.toUpperCase())) {
                return res.status(400).json({
                    status: 'error',
                    message: `Invalid status value. Must be one of: ${VALID_STATUSES.join(', ')}.`
                });
            }
            updateData.status = status.toUpperCase();
        }

        // 2. Quoted amount validation
        if (quotedAmount !== undefined && quotedAmount !== null && quotedAmount !== '') {
            const numAmount = Number(quotedAmount);
            if (isNaN(numAmount) || numAmount < 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Quoted amount must be a valid non-negative number.'
                });
            }
            updateData.quotedAmount = numAmount;
        } else if (quotedAmount === null || quotedAmount === '') {
            updateData.quotedAmount = null;
        }

        // 3. Admin notes validation
        if (adminNotes !== undefined) {
            if (adminNotes === null) {
                updateData.adminNotes = null;
            } else if (typeof adminNotes === 'string') {
                updateData.adminNotes = adminNotes.trim() || null;
            }
        }

        // 4. Workflow State Rule: Status QUOTED requires a positive quotedAmount
        const targetStatus = updateData.status !== undefined ? updateData.status : quote.status;
        const targetQuotedAmount = updateData.quotedAmount !== undefined ? updateData.quotedAmount : quote.quotedAmount;

        if (targetStatus === 'QUOTED') {
            if (targetQuotedAmount === null || targetQuotedAmount === undefined || isNaN(Number(targetQuotedAmount)) || Number(targetQuotedAmount) <= 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'A valid positive quoted amount is required before transitioning quote status to QUOTED.'
                });
            }
            if (!quote.customerAccessToken && !updateData.customerAccessToken) {
                updateData.customerAccessToken = crypto.randomBytes(32).toString('hex');
                updateData.customerAccessTokenCreatedAt = new Date();
            }
        }

        const updatedQuote = await prisma.quote.update({
            where: { id },
            data: updateData
        });

        res.status(200).json({
            status: 'success',
            message: 'Quote updated successfully',
            data: { quote: updatedQuote }
        });
    } catch (error) {
        console.error('Failed to update quote:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update quote',
            error: error.message || String(error)
        });
    }
};

router.patch('/:id', authMiddleware, handleQuoteUpdate);
router.patch('/:id/status', authMiddleware, handleQuoteUpdate);
router.put('/:id', authMiddleware, handleQuoteUpdate);

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