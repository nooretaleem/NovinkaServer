// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

// No adapter needed for Prisma 6
const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding database...');

    // ============================================
    // SEED USERS
    // ============================================

    const users = [
        {
            name: 'Admin User',
            email: 'admin@novinka.com',
            password: 'Admin@123',
            role: 'ADMIN',
        },
        {
            name: 'Manager User',
            email: 'manager@novinka.com',
            password: 'Manager@123',
            role: 'MANAGER',
        },
        {
            name: 'Staff User',
            email: 'staff@novinka.com',
            password: 'Staff@123',
            role: 'STAFF',
        }
    ];

    console.log('👤 Creating users...');

    for (const userData of users) {
        const hashedPassword = await bcrypt.hash(userData.password, 10);

        const user = await prisma.user.upsert({
            where: { email: userData.email },
            update: {
                name: userData.name,
                role: userData.role,
                password: hashedPassword,
            },
            create: {
                name: userData.name,
                email: userData.email,
                password: hashedPassword,
                role: userData.role,
            },
        });

        console.log(`✅ Created user: ${user.email} (${user.role})`);
    }

    // ============================================
    // SEED SAMPLE PROJECTS
    // ============================================

    const projects = [
        {
            title: 'Luxury Villa - Lahore',
            location: 'Lahore, Pakistan',
            projectType: 'Residential',
            description: 'A stunning modern luxury villa with premium finishes and smart home features.',
            gallery: JSON.stringify(['villa1.jpg', 'villa2.jpg', 'villa3.jpg']),
            isFeatured: true,
        },
        {
            title: 'Corporate Tower - Islamabad',
            location: 'Islamabad, Pakistan',
            projectType: 'Commercial',
            description: 'State-of-the-art corporate headquarters with sustainable design.',
            gallery: JSON.stringify(['tower1.jpg', 'tower2.jpg']),
            isFeatured: true,
        },
        {
            title: 'Garden Estate - Karachi',
            location: 'Karachi, Pakistan',
            projectType: 'Residential',
            description: 'Luxury gated community with landscaped gardens and modern amenities.',
            gallery: JSON.stringify(['estate1.jpg', 'estate2.jpg', 'estate3.jpg']),
            isFeatured: false,
        }
    ];

    console.log('🏗️ Creating sample projects...');

    for (const projectData of projects) {
        const project = await prisma.project.create({
            data: projectData,
        });
        console.log(`✅ Created project: ${project.title}`);
    }

    // ============================================
    // SEED SAMPLE SERVICES
    // ============================================

    const services = [
        {
            name: 'Architectural Design',
            icon: 'fa-building',
            description: 'Complete architectural design services from concept to completion.',
            features: JSON.stringify(['3D Rendering', 'Blueprints', 'Consultation', 'Site Planning']),
            displayOrder: 1,
        },
        {
            name: 'Construction Management',
            icon: 'fa-hard-hat',
            description: 'Professional construction management and project supervision.',
            features: JSON.stringify(['Project Planning', 'Quality Control', 'Budget Management', 'Timeline Management']),
            displayOrder: 2,
        },
        {
            name: 'Interior Design',
            icon: 'fa-paint-roller',
            description: 'Elegant interior design solutions for residential and commercial spaces.',
            features: JSON.stringify(['Space Planning', 'Material Selection', 'Furniture Design', 'Lighting Design']),
            displayOrder: 3,
        },
        {
            name: 'Landscape Architecture',
            icon: 'fa-tree',
            description: 'Beautiful landscape design and garden planning services.',
            features: JSON.stringify(['Garden Design', 'Hardscape Planning', 'Irrigation Systems', 'Plant Selection']),
            displayOrder: 4,
        }
    ];

    console.log('🌿 Creating sample services...');

    for (const serviceData of services) {
        const service = await prisma.service.create({
            data: serviceData,
        });
        console.log(`✅ Created service: ${service.name}`);
    }

    console.log('✅ Seeding completed!');
    console.log('📊 Summary:');
    console.log(`   - ${users.length} users created`);
    console.log(`   - ${projects.length} projects created`);
    console.log(`   - ${services.length} services created`);
}

main()
    .catch((e) => {
        console.error('❌ Error seeding database:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });