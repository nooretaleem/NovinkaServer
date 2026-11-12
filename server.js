// server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const prisma = require('./src/config/prisma');
require('dotenv').config();

const app = express();

// Trust proxy for Vercel serverless environment
app.set('trust proxy', 1);

// ============================================
// CORS CONFIGURATION (MUST RUN BEFORE ALL OTHER MIDDLEWARE)
// ============================================

const allowedOrigins = [
    'http://localhost:4200',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'https://novinkaconstructions.com',
    'https://www.novinkaconstructions.com',
    'https://novinkacms.novinkaconstructions.com'
];

if (process.env.PUBLIC_SITE_URL) {
    const pubUrl = process.env.PUBLIC_SITE_URL.trim().replace(/\/$/, '');
    if (pubUrl && !allowedOrigins.includes(pubUrl)) allowedOrigins.push(pubUrl);
}
if (process.env.FRONTEND_URL) {
    const frontUrl = process.env.FRONTEND_URL.trim().replace(/\/$/, '');
    if (frontUrl && !allowedOrigins.includes(frontUrl)) allowedOrigins.push(frontUrl);
}

// Origin validation helper supporting subdomains and normalized URLs
function isOriginAllowed(origin) {
    if (!origin) return true; // Server-to-server, cron, health check
    const normalized = origin.trim().replace(/\/$/, '').toLowerCase();
    if (allowedOrigins.map(o => o.toLowerCase()).includes(normalized)) return true;

    try {
        const url = new URL(normalized);
        // Allow any subdomain of novinkaconstructions.com over https
        if (url.protocol === 'https:' && (url.hostname === 'novinkaconstructions.com' || url.hostname.endsWith('.novinkaconstructions.com'))) {
            return true;
        }
        // Allow Vercel preview environments
        if (url.protocol === 'https:' && url.hostname.endsWith('.vercel.app')) {
            return true;
        }
    } catch (e) {
        return false;
    }
    return false;
}

const corsOptions = {
    origin: function (origin, callback) {
        if (isOriginAllowed(origin)) {
            return callback(null, true);
        }
        console.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
        return callback(new Error(`CORS Policy: Origin ${origin} not allowed.`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'X-CSRF-Token',
        'Range'
    ],
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'Authorization'],
    maxAge: 86400, // 24 hours preflight cache
    optionsSuccessStatus: 204
};

// 1. Fast-path Preflight OPTIONS & CORS headers for Vercel
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-CSRF-Token, Range');
        res.setHeader('Access-Control-Max-Age', '86400');
        return res.status(204).end();
    }
    next();
});

// 2. Standard CORS middleware for all actual requests
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ============================================
// OTHER MIDDLEWARE
// ============================================

// Security headers with cross-origin enabled
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(compression());

// Rate Limiting (Bypasses OPTIONS so preflight is never blocked)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300,
    skip: (req) => req.method === 'OPTIONS',
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many requests, please try again later.' }
});
app.use('/api', limiter);

// Logging
app.use(morgan('dev'));

// Body Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ============================================
// ROUTES
// ============================================

// Import routes
const authRoutes = require('./src/routes/auth.routes');
const userRoutes = require('./src/routes/user.routes');
const projectRoutes = require('./src/routes/project.routes');
const serviceRoutes = require('./src/routes/service.routes');
const dashboardRoutes = require('./src/routes/dashboard.routes');
//const categoryRoutes = require('./src/routes/category.routes');
const blogRoutes = require('./src/routes/blog.routes');
const notificationRoutes = require('./src/routes/notification.routes');
const quoteRoutes = require('./src/routes/quote.routes');
const messageRoutes = require('./src/routes/message.routes');
const inventoryRoutes = require('./src/routes/inventory.routes');
const employeeRoutes = require('./src/routes/employee.routes');
const sitemapRoutes = require('./src/routes/sitemap.routes');
const estimatorConfigRoutes = require('./src/routes/estimator-config.routes');
const uploadRoutes = require('./src/routes/upload.routes');
const locationRoutes = require('./src/routes/locations.routes');
const wadanzaVideosRoutes = require('./src/routes/wadanza-videos.routes');
const wadanzaGalleryRoutes = require('./src/routes/wadanza-gallery.routes');


// Use routes
app.use('/sitemap.xml', sitemapRoutes);
app.use('/api/sitemap.xml', sitemapRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/estimator-config', estimatorConfigRoutes);
app.use('/api', dashboardRoutes);
//app.use('/api/categories', categoryRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/notifications', notificationRoutes.router);
app.use('/api/quotes', quoteRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/wadanza-videos', wadanzaVideosRoutes);
app.use('/api/wadanza-gallery', wadanzaGalleryRoutes);

app.get('/', (req, res) => {
    res.json({
        success: true,
        name: 'NOVINKA API',
        version: '1.0.0',
        health: '/api/health'
    });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV
    });
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((err, req, res, next) => {
    // Handle CORS Policy Errors gracefully
    if (err.message && err.message.includes('CORS')) {
        return res.status(403).json({
            status: 'error',
            code: 'CORS_FORBIDDEN',
            message: err.message
        });
    }

    console.error('Error:', err.message);
    res.status(err.status || 500).json({
        status: 'error',
        message: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        status: 'error',
        message: 'Route not found'
    });
});

// ============================================
// START SERVER
// ============================================

// Only listen when running locally (not in Vercel Serverless environment)
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`📁 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 API URL: http://localhost:${PORT}/api`);
    });
}

// Graceful shutdown
process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
});

module.exports = app;