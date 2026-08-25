// src/routes/estimator-config.routes.js
const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middleware/auth.middleware');

const DEFAULT_ESTIMATOR_CONFIG = {
    contractTypes: {
        turnkey: {
            name: "With Material (Turnkey)",
            baseRate: 12000,
            labourPercent: 35,
            companyFeePercent: 15,
            engineeringPercent: 5,
            services: [
                "Material Procurement",
                "Labour Management",
                "Site Supervision",
                "Project Management",
                "Structural Works",
                "Plumbing & Electrical",
                "Finishing & Painting",
                "Flooring & Kitchens",
                "Bathrooms",
                "Quality Control",
                "Final Handover"
            ]
        },
        percentage: {
            name: "Percentage Basis",
            baseRate: 6000,
            labourPercent: 40,
            companyFeePercent: 10,
            engineeringPercent: 3,
            services: [
                "Labour Management",
                "Site Engineers",
                "Daily Supervision",
                "Quality Control",
                "Contractor Coordination",
                "Material Verification",
                "Timeline Management",
                "Progress Reports"
            ]
        },
        consultancy: {
            name: "Consultancy",
            baseRate: 3000,
            labourPercent: 0,
            companyFeePercent: 5,
            engineeringPercent: 8,
            services: [
                "BOQ Preparation",
                "Cost Estimation",
                "Structural Guidance",
                "Material Quantity Verification",
                "Site Visits",
                "Quality Inspection",
                "Contractor Evaluation",
                "Engineering Advice"
            ]
        }
    },
    defaultBaseRate: 8000,
    qualityMultiplierFactor: 0.5,
    timelineSqFtPerUnit: 500,
    timelineMonthsPerUnit: 6,
    boqCategories: [
        { name: "Foundation", percentage: 12 },
        { name: "RCC Structure", percentage: 18 },
        { name: "Brick Masonry", percentage: 10 },
        { name: "Roof", percentage: 8 },
        { name: "Electrical", percentage: 6 },
        { name: "Plumbing", percentage: 5 },
        { name: "Ceiling", percentage: 4 },
        { name: "Flooring", percentage: 8 },
        { name: "Paint", percentage: 5 },
        { name: "Kitchen", percentage: 6 },
        { name: "Bathrooms", percentage: 5 },
        { name: "Doors", percentage: 4 },
        { name: "Windows", percentage: 3 },
        { name: "Waterproofing", percentage: 3 },
        { name: "External Works", percentage: 3 }
    ]
};

// ============================================
// GET ESTIMATOR CONFIG (Public)
// ============================================
router.get('/', async (req, res) => {
    try {
        const setting = await prisma.setting.findUnique({
            where: { key: 'estimator_config' }
        });

        if (!setting || !setting.value) {
            return res.json({
                success: true,
                data: DEFAULT_ESTIMATOR_CONFIG,
                isDefault: true
            });
        }

        res.json({
            success: true,
            data: setting.value,
            isDefault: false
        });
    } catch (error) {
        console.error('Error fetching estimator config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch estimator configuration',
            error: error.message,
            fallbackData: DEFAULT_ESTIMATOR_CONFIG
        });
    }
});

// ============================================
// UPDATE ESTIMATOR CONFIG (Admin / Manager)
// ============================================
router.put('/', authMiddleware, roleMiddleware(['ADMIN', 'MANAGER']), async (req, res) => {
    try {
        const configData = req.body;

        if (!configData || typeof configData !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Invalid configuration data'
            });
        }

        // Validate BOQ total percentage if categories provided
        if (Array.isArray(configData.boqCategories)) {
            const totalPercent = configData.boqCategories.reduce((sum, item) => sum + (parseFloat(item.percentage) || 0), 0);
            if (Math.abs(totalPercent - 100) > 0.5) {
                return res.status(400).json({
                    success: false,
                    message: `BOQ categories percentages must total 100%. Current total: ${totalPercent.toFixed(1)}%`
                });
            }
        }

        const setting = await prisma.setting.upsert({
            where: { key: 'estimator_config' },
            update: {
                value: configData,
                category: 'estimator'
            },
            create: {
                key: 'estimator_config',
                value: configData,
                category: 'estimator'
            }
        });

        res.json({
            success: true,
            message: 'Estimator configuration updated successfully',
            data: setting.value
        });
    } catch (error) {
        console.error('Error updating estimator config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update estimator configuration',
            error: error.message
        });
    }
});

module.exports = router;
