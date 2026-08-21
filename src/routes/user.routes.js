// src/routes/user.routes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const uploadToCloudinary = require('../utils/cloudinary-upload');
const prisma = require('../config/prisma');

// ============================================
// GET ALL USERS (Admin Only)
// ============================================
router.get('/', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
    try {
        const { search, role, status } = req.query;

        const where = {};
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } }
            ];
        }

        if (role && ['ADMIN', 'MANAGER', 'STAFF'].includes(role.toUpperCase())) {
            where.role = role.toUpperCase();
        }

        if (status !== undefined && status !== '') {
            where.isActive = status === 'active' || status === 'true';
        }

        const users = await prisma.user.findMany({
            where,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                avatar: true,
                isActive: true,
                lastLogin: true,
                createdAt: true
            },
            orderBy: { createdAt: 'desc' }
        });

        const total = users.length;
        const active = users.filter(u => u.isActive).length;
        const inactive = total - active;

        res.status(200).json({
            status: 'success',
            data: {
                users,
                summary: { total, active, inactive }
            }
        });
    } catch (error) {
        console.error('Fetch users error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch users'
        });
    }
});

// ============================================
// GET SINGLE USER (Admin Only or Self)
// ============================================
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        if (req.user.role !== 'ADMIN' && req.user.id !== id) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied'
            });
        }

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                avatar: true,
                isActive: true,
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
        console.error('Fetch user error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch user details'
        });
    }
});

// ============================================
// CREATE USER (Admin Only)
// ============================================
router.post('/', authMiddleware, roleMiddleware(['ADMIN']), upload.single('avatar'), async (req, res) => {
    try {
        const { name, email, password, role, isActive } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ status: 'error', message: 'Full name is required' });
        }
        if (!email || !email.trim()) {
            return res.status(400).json({ status: 'error', message: 'Email address is required' });
        }
        if (!password || password.length < 6) {
            return res.status(400).json({ status: 'error', message: 'Password must be at least 6 characters' });
        }

        // Check unique email
        const existingUser = await prisma.user.findUnique({
            where: { email: email.trim().toLowerCase() }
        });

        if (existingUser) {
            return res.status(400).json({
                status: 'error',
                message: 'A user with this email address already exists'
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Upload avatar to Cloudinary if file provided
        let avatarUrl = null;
        if (req.file) {
            try {
                const uploadResult = await uploadToCloudinary(req.file.buffer, 'users');
                avatarUrl = uploadResult.secure_url;
            } catch (uploadErr) {
                console.error('Failed to upload user avatar to Cloudinary:', uploadErr);
            }
        }

        const userRole = (role && ['ADMIN', 'MANAGER', 'STAFF'].includes(role.toUpperCase()))
            ? role.toUpperCase()
            : 'STAFF';

        const activeStatus = isActive === true || isActive === 'true';

        const newUser = await prisma.user.create({
            data: {
                name: name.trim(),
                email: email.trim().toLowerCase(),
                password: hashedPassword,
                role: userRole,
                avatar: avatarUrl,
                isActive: activeStatus
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                avatar: true,
                isActive: true,
                createdAt: true
            }
        });

        res.status(201).json({
            status: 'success',
            data: { user: newUser },
            message: 'User created successfully'
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({
            status: 'error',
            message: error?.message || 'Failed to create user'
        });
    }
});

// ============================================
// UPDATE USER (Admin Only or Self)
// ============================================
router.put('/:id', authMiddleware, upload.single('avatar'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, password, role, isActive } = req.body;

        if (req.user.role !== 'ADMIN' && req.user.id !== id) {
            return res.status(403).json({
                status: 'error',
                message: 'You do not have permission to update this user'
            });
        }

        const existingUser = await prisma.user.findUnique({ where: { id } });
        if (!existingUser) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        // Email uniqueness check if email is changed
        if (email && email.trim().toLowerCase() !== existingUser.email.toLowerCase()) {
            const emailTaken = await prisma.user.findUnique({
                where: { email: email.trim().toLowerCase() }
            });
            if (emailTaken) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Email address is already in use by another account'
                });
            }
        }

        const updateData = {};
        if (name) updateData.name = name.trim();
        if (email) updateData.email = email.trim().toLowerCase();

        // Optional password update
        if (password && password.trim().length >= 6) {
            updateData.password = await bcrypt.hash(password.trim(), 10);
        }

        // Admin-only field updates
        if (req.user.role === 'ADMIN') {
            if (role && ['ADMIN', 'MANAGER', 'STAFF'].includes(role.toUpperCase())) {
                updateData.role = role.toUpperCase();
            }
            if (isActive !== undefined) {
                updateData.isActive = isActive === true || isActive === 'true';
            }
        }

        // Avatar upload update
        if (req.file) {
            try {
                const uploadResult = await uploadToCloudinary(req.file.buffer, 'users');
                updateData.avatar = uploadResult.secure_url;
            } catch (uploadErr) {
                console.error('Failed to upload updated user avatar:', uploadErr);
            }
        }

        const updatedUser = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                avatar: true,
                isActive: true,
                lastLogin: true,
                createdAt: true
            }
        });

        res.status(200).json({
            status: 'success',
            data: { user: updatedUser },
            message: 'User updated successfully'
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update user'
        });
    }
});

// ============================================
// DELETE USER (Admin Only)
// ============================================
router.delete('/:id', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
    try {
        const { id } = req.params;

        if (req.user.id === id) {
            return res.status(400).json({
                status: 'error',
                message: 'You cannot delete your own account'
            });
        }

        const existingUser = await prisma.user.findUnique({ where: { id } });
        if (!existingUser) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        await prisma.user.delete({ where: { id } });

        res.status(200).json({
            status: 'success',
            message: 'User deleted successfully'
        });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete user'
        });
    }
});

module.exports = router;