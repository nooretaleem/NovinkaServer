// ============================================
// EMPLOYEE ROUTES - NOVINKA CONSTRUCTIONS
// ============================================
const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const uploadToCloudinary = require('../utils/cloudinary-upload');
const deleteFromCloudinary = require('../utils/cloudinary-delete');

/**
 * Generate a URL-friendly slug from a string
 */
function generateSlug(text) {
    if (!text) return '';
    return text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Get a guaranteed unique slug for an employee
 */
async function getUniqueSlug(baseName, currentId = null) {
    let slug = generateSlug(baseName);
    if (!slug) slug = 'employee';
    let uniqueSlug = slug;
    let count = 1;

    while (true) {
        const existing = await prisma.employee.findUnique({
            where: { slug: uniqueSlug }
        });
        if (!existing || (currentId && existing.id === currentId)) {
            return uniqueSlug;
        }
        uniqueSlug = `${slug}-${count}`;
        count++;
    }
}

/**
 * GET /api/employees
 * Public endpoint to get active employees.
 * Defaults strictly to isActive = true for public visitors.
 * Admin/Manager can pass includeInactive=true or isActive=false.
 */
router.get('/', async (req, res) => {
    try {
        const { search, isActive, includeInactive, page, limit } = req.query;

        const where = {};

        // By default, public API strictly enforces isActive = true
        if (includeInactive === 'true' || isActive === 'all' || isActive === 'false' || isActive === '0') {
            if (isActive === 'false' || isActive === '0') {
                where.isActive = false;
            }
            // If includeInactive === 'true' or isActive === 'all', don't filter isActive
        } else {
            where.isActive = true;
        }

        if (search && search.trim()) {
            const searchTerm = search.trim();
            where.OR = [
                { name: { contains: searchTerm } },
                { designation: { contains: searchTerm } }
            ];
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 50;
        const skip = (pageNum - 1) * limitNum;

        const [employees, total] = await Promise.all([
            prisma.employee.findMany({
                where,
                orderBy: [
                    { displayOrder: 'asc' },
                    { createdAt: 'desc' }
                ],
                skip,
                take: limitNum
            }),
            prisma.employee.count({ where })
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                employees,
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum)
                }
            }
        });
    } catch (error) {
        console.error('Error fetching employees:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch employees',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /api/employees/:idOrSlug
 * Get a single employee by ID or Slug.
 * Public access returns 404 for inactive employees.
 */
router.get('/:idOrSlug', async (req, res) => {
    try {
        const { idOrSlug } = req.params;

        let employee = await prisma.employee.findUnique({
            where: { id: idOrSlug }
        });

        if (!employee) {
            employee = await prisma.employee.findUnique({
                where: { slug: idOrSlug }
            });
        }

        if (!employee || !employee.isActive) {
            return res.status(404).json({
                status: 'error',
                message: 'Employee not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: employee
        });
    } catch (error) {
        console.error('Error fetching employee detail:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch employee details',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * POST /api/employees
 * Protected endpoint to create a new employee record (Admin/Manager)
 */
router.post(
    '/',
    authMiddleware,
    roleMiddleware(['ADMIN', 'MANAGER']),
    upload.single('image'),
    async (req, res) => {
        let uploadedPublicId = null;
        try {
            const { name, designation, shortBio, isActive, displayOrder, slug } = req.body;

            if (!name || !name.trim()) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Employee name is required'
                });
            }

            if (!designation || !designation.trim()) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Employee designation is required'
                });
            }

            const uniqueSlug = await getUniqueSlug(slug || name);

            let imageUrl = null;

            if (req.file) {
                const uploadResult = await uploadToCloudinary(req.file.buffer, 'employees');
                imageUrl = uploadResult.secure_url;
                uploadedPublicId = uploadResult.public_id;
            }

            const isBoolActive = isActive === undefined ? true : (isActive === 'true' || isActive === true || isActive === '1');
            const parsedDisplayOrder = parseInt(displayOrder, 10) || 0;

            const newEmployee = await prisma.employee.create({
                data: {
                    name: name.trim(),
                    slug: uniqueSlug,
                    designation: designation.trim(),
                    shortBio: shortBio ? shortBio.trim() : null,
                    image: imageUrl,
                    imagePublicId: uploadedPublicId,
                    isActive: isBoolActive,
                    displayOrder: parsedDisplayOrder
                }
            });

            res.status(201).json({
                status: 'success',
                message: 'Employee created successfully',
                data: newEmployee
            });
        } catch (error) {
            // Clean up newly uploaded image if database save fails
            if (uploadedPublicId) {
                await deleteFromCloudinary(uploadedPublicId).catch(() => { });
            }
            console.error('Error creating employee:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to create employee record',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

/**
 * PUT /api/employees/reorder
 * Protected endpoint to update employee display order (Admin/Manager)
 */
router.put(
    '/reorder',
    authMiddleware,
    roleMiddleware(['ADMIN', 'MANAGER']),
    async (req, res) => {
        try {
            const { items } = req.body; // Array of { id, displayOrder }

            if (!Array.isArray(items) || items.length === 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Items array is required for reordering'
                });
            }

            const updatePromises = items.map(item =>
                prisma.employee.update({
                    where: { id: item.id },
                    data: { displayOrder: parseInt(item.displayOrder, 10) || 0 }
                })
            );

            await prisma.$transaction(updatePromises);

            res.status(200).json({
                status: 'success',
                message: 'Employee display order updated successfully'
            });
        } catch (error) {
            console.error('Error reordering employees:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to reorder employees',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

/**
 * PUT /api/employees/:id
 * Protected endpoint to update an employee record (Admin/Manager)
 */
router.put(
    '/:id',
    authMiddleware,
    roleMiddleware(['ADMIN', 'MANAGER']),
    upload.single('image'),
    async (req, res) => {
        let newlyUploadedPublicId = null;
        try {
            const { id } = req.params;
            const { name, designation, shortBio, isActive, displayOrder, slug } = req.body;

            const existingEmployee = await prisma.employee.findUnique({
                where: { id }
            });

            if (!existingEmployee) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Employee not found'
                });
            }

            let updatedSlug = existingEmployee.slug;
            if (slug && slug.trim()) {
                updatedSlug = await getUniqueSlug(slug.trim(), id);
            } else if (name && name.trim() && name.trim() !== existingEmployee.name) {
                updatedSlug = await getUniqueSlug(name.trim(), id);
            }

            let imageUrl = existingEmployee.image;
            let imagePublicId = existingEmployee.imagePublicId;

            if (req.file) {
                const uploadResult = await uploadToCloudinary(req.file.buffer, 'employees');
                imageUrl = uploadResult.secure_url;
                newlyUploadedPublicId = uploadResult.public_id;

                // Delete old image from Cloudinary if replacing
                if (existingEmployee.imagePublicId) {
                    await deleteFromCloudinary(existingEmployee.imagePublicId);
                }

                imagePublicId = newlyUploadedPublicId;
            }

            const updateData = {};
            if (name !== undefined) updateData.name = name.trim();
            if (designation !== undefined) updateData.designation = designation.trim();
            if (shortBio !== undefined) updateData.shortBio = shortBio ? shortBio.trim() : null;
            if (isActive !== undefined) updateData.isActive = (isActive === 'true' || isActive === true || isActive === '1');
            if (displayOrder !== undefined) updateData.displayOrder = parseInt(displayOrder, 10) || 0;
            updateData.slug = updatedSlug;
            updateData.image = imageUrl;
            updateData.imagePublicId = imagePublicId;

            const updatedEmployee = await prisma.employee.update({
                where: { id },
                data: updateData
            });

            res.status(200).json({
                status: 'success',
                message: 'Employee updated successfully',
                data: updatedEmployee
            });
        } catch (error) {
            // Clean up newly uploaded image if database save fails
            if (newlyUploadedPublicId) {
                await deleteFromCloudinary(newlyUploadedPublicId).catch(() => { });
            }
            console.error('Error updating employee:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to update employee record',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

/**
 * DELETE /api/employees/:id
 * Protected endpoint to delete an employee record (Admin/Manager)
 */
router.delete(
    '/:id',
    authMiddleware,
    roleMiddleware(['ADMIN', 'MANAGER']),
    async (req, res) => {
        try {
            const { id } = req.params;

            const existingEmployee = await prisma.employee.findUnique({
                where: { id }
            });

            if (!existingEmployee) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Employee not found'
                });
            }

            // Remove image from Cloudinary if exists
            if (existingEmployee.imagePublicId) {
                await deleteFromCloudinary(existingEmployee.imagePublicId);
            }

            await prisma.employee.delete({
                where: { id }
            });

            res.status(200).json({
                status: 'success',
                message: 'Employee record deleted successfully'
            });
        } catch (error) {
            console.error('Error deleting employee:', error);
            res.status(500).json({
                status: 'error',
                message: 'Failed to delete employee record',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

module.exports = router;
