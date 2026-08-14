// src/routes/user.routes.js
const express = require('express');
const router = express.Router();
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Get all users (Admin/Manager only)
router.get('/', authMiddleware, roleMiddleware(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const users = await prisma.user.findMany({
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

        res.status(200).json({
            status: 'success',
            data: { users }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch users'
        });
    }
});

// Get single user
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

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
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch user'
        });
    }
});

// Update user
router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, role, isActive } = req.body;

        // Check if user has permission (Admin can update anyone, others can only update themselves)
        if (req.user.role !== 'ADMIN' && req.user.id !== id) {
            return res.status(403).json({
                status: 'error',
                message: 'You do not have permission to update this user'
            });
        }

        // Non-admin users cannot change role or isActive
        const updateData = { name, email };
        if (req.user.role === 'ADMIN') {
            if (role) updateData.role = role;
            if (isActive !== undefined) updateData.isActive = isActive;
        }

        const user = await prisma.user.update({
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
            data: { user },
            message: 'User updated successfully'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to update user'
        });
    }
});

// Delete user (Admin only)
router.delete('/:id', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
    try {
        const { id } = req.params;

        // Prevent deleting yourself
        if (req.user.id === id) {
            return res.status(400).json({
                status: 'error',
                message: 'You cannot delete your own account'
            });
        }

        await prisma.user.delete({
            where: { id }
        });

        res.status(200).json({
            status: 'success',
            message: 'User deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to delete user'
        });
    }
});

module.exports = router;