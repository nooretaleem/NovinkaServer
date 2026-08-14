// src/routes/auth.routes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');

// Public routes
router.post('/login', authController.login);
router.post('/logout', authController.logout);

// Protected routes
router.get('/me', authMiddleware, authController.getCurrentUser);
router.post('/change-password', authMiddleware, authController.changePassword);

// Admin only routes
router.post('/register', authMiddleware, roleMiddleware(['ADMIN']), authController.register);

module.exports = router;