// src/controllers/auth.controller.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

// ============================================
// LOGIN
// ============================================
const login = async (req, res) => {
    try {
        const { email, password, rememberMe } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                status: 'error',
                message: 'Email and password are required'
            });
        }

        // Find user
        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid email or password'
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(403).json({
                status: 'error',
                message: 'Your account has been deactivated'
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid email or password'
            });
        }

        // Update last login
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });

        // Generate token
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role
            },
            process.env.JWT_SECRET,
            { expiresIn: rememberMe ? '7d' : '24h' }
        );

        // Remove password from response
        const { password: _, ...userWithoutPassword } = user;

        res.status(200).json({
            status: 'success',
            data: {
                token,
                user: userWithoutPassword
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Login failed. Please try again.'
        });
    }
};

// ============================================
// GET CURRENT USER
// ============================================
const getCurrentUser = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                avatar: true,
                lastLogin: true,
                createdAt: true
            }
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: { user }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch user data'
        });
    }
};

// ============================================
// CHANGE PASSWORD
// ============================================
const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                status: 'error',
                message: 'Current password and new password are required'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                status: 'error',
                message: 'New password must be at least 6 characters'
            });
        }

        // Get user with password
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, user.password);
        if (!isValidPassword) {
            return res.status(401).json({
                status: 'error',
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedPassword }
        });

        res.status(200).json({
            status: 'success',
            message: 'Password changed successfully'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to change password'
        });
    }
};

// ============================================
// LOGOUT
// ============================================
const logout = (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'Logged out successfully'
    });
};

// ============================================
// REGISTER (Admin Only)
// ============================================
const register = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        // Validate input
        if (!name || !email || !password) {
            return res.status(400).json({
                status: 'error',
                message: 'Name, email and password are required'
            });
        }

        // Check if user exists
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            return res.status(400).json({
                status: 'error',
                message: 'Email already registered'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                role: role || 'STAFF'
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
                createdAt: true
            }
        });

        res.status(201).json({
            status: 'success',
            data: { user },
            message: 'User created successfully'
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Registration failed. Please try again.'
        });
    }
};

module.exports = {
    login,
    getCurrentUser,
    changePassword,
    logout,
    register
};