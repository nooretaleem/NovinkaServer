// server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();

// ============================================
// MIDDLEWARE
// ============================================

// Security
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(compression());

const allowedOrigins = [
    'http://localhost:4200',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://novinka-admin.vercel.app',
    'https://novinkaconstructions.netlify.app',
    'https://novinkaconstructions.com',
    'https://www.novinkaconstructions.com',
    'https://www.novinkaconstructions.netlify.app',
    'https://novinka-client.vercel.app'
];

if (process.env.PUBLIC_SITE_URL) {
    const pubUrl = process.env.PUBLIC_SITE_URL.trim().replace(/\/$/, '');
    if (pubUrl && !allowedOrigins.includes(pubUrl)) allowedOrigins.push(pubUrl);
}
if (process.env.FRONTEND_URL) {
    const frontUrl = process.env.FRONTEND_URL.trim().replace(/\/$/, '');
    if (frontUrl && !allowedOrigins.includes(frontUrl)) allowedOrigins.push(frontUrl);
}

const corsOptions = {
    origin: function (origin, callback) {
        // Allow server-to-server / Postman requests (no Origin header)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    optionsSuccessStatus: 200
};

// CORS Middleware & OPTIONS Preflight
app.use(cors(corsOptions));
//app.options('*', cors(corsOptions));

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests from this IP, please try again later.'
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


// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api', dashboardRoutes);
//app.use('/api/categories', categoryRoutes);
app.use('/api/blogs', blogRoutes);
app.use('/api/notifications', notificationRoutes.router);
app.use('/api/quotes', quoteRoutes);
app.use('/api/messages', messageRoutes);

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

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📁 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 API URL: http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
});

module.exports = app;