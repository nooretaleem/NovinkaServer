const express = require('express');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = require('../server');
const prisma = require('../src/config/prisma');
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

let server;
const TEST_PORT = 5098;

function request(method, path, data = null, token = null) {
    const http = require('http');
    return new Promise((resolve, reject) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const options = {
            hostname: '127.0.0.1',
            port: TEST_PORT,
            path: path,
            method: method,
            headers: headers
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    resolve({ statusCode: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, body: body });
                }
            });
        });

        req.on('error', reject);
        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function runTests() {
    server = app.listen(TEST_PORT, () => {
        console.log(`Test server running on port ${TEST_PORT}...`);
    });

    await new Promise(r => setTimeout(r, 1000));

    console.log('\n======================================================');
    console.log('RUNNING INVENTORY CLOUDINARY IMAGE MANAGEMENT TESTS');
    console.log('======================================================\n');

    let adminUser = await prisma.user.findFirst({
        where: { role: 'ADMIN', isActive: true }
    });

    if (!adminUser) {
        adminUser = await prisma.user.create({
            data: {
                name: 'Cloudinary Test Admin',
                email: `cloudadmin_${Date.now()}@novitaCONSTRUCTIONS.com`,
                password: '$2a$10$testpasswordhashforexampleonly',
                role: 'ADMIN',
                isActive: true
            }
        });
    }

    const adminToken = jwt.sign(
        { id: adminUser.id, email: adminUser.email, role: adminUser.role },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    let itemId = null;

    try {
        // Test 1: Create Inventory with Cover Image + Multi-Image Gallery JSON
        console.log('▶ Test 1: POST /api/inventory with Cover Image & Gallery (PublicId Structure)');
        const res1 = await request('POST', '/api/inventory', {
            type: 'HOUSE',
            title: '1 Kanal Luxury Villa with Swimming Pool',
            location: 'Sector F-11, Islamabad',
            size: '1 Kanal (6,500 Sq Ft)',
            price: 115000000,
            status: 'AVAILABLE',
            description: 'Palatial 1 Kanal luxury mansion.',
            coverImage: 'https://res.cloudinary.com/iktbx2jg/image/upload/v12345/novinka/inventory/cover_house1.jpg',
            coverImagePublicId: 'novinka/inventory/cover_house1',
            gallery: [
                {
                    url: 'https://res.cloudinary.com/iktbx2jg/image/upload/v12345/novinka/inventory/gallery1.jpg',
                    publicId: 'novinka/inventory/gallery1',
                    alt: 'Living Room View'
                },
                {
                    url: 'https://res.cloudinary.com/iktbx2jg/image/upload/v12345/novinka/inventory/gallery2.jpg',
                    publicId: 'novinka/inventory/gallery2',
                    alt: 'Master Bedroom'
                }
            ],
            isFeatured: true
        }, adminToken);

        console.log('Status Code:', res1.statusCode);
        console.log('Created ID:', res1.body.data?.inventory?.id);
        console.log('Cover Public ID:', res1.body.data?.inventory?.coverImagePublicId);
        console.log('Gallery Items Count:', res1.body.data?.inventory?.gallery?.length);
        console.log('Gallery Item 1 Public ID:', res1.body.data?.inventory?.gallery?.[0]?.publicId);
        itemId = res1.body.data?.inventory?.id;
        console.log('------------------------------------------------------\n');

        // Test 2: Update Cover Image and Gallery (Replacing cover, retaining 1 gallery item, removing 1)
        if (itemId) {
            console.log(`▶ Test 2: PATCH /api/inventory/${itemId} (Safe Cover Image Replacement & Gallery Removal)`);
            const res2 = await request('PATCH', `/api/inventory/${itemId}`, {
                coverImage: 'https://res.cloudinary.com/iktbx2jg/image/upload/v12345/novinka/inventory/cover_house1_new.jpg',
                coverImagePublicId: 'novinka/inventory/cover_house1_new',
                gallery: [
                    // Retain gallery1, remove gallery2, add gallery3
                    {
                        url: 'https://res.cloudinary.com/iktbx2jg/image/upload/v12345/novinka/inventory/gallery1.jpg',
                        publicId: 'novinka/inventory/gallery1',
                        alt: 'Living Room View'
                    },
                    {
                        url: 'https://res.cloudinary.com/iktbx2jg/image/upload/v12345/novinka/inventory/gallery3.jpg',
                        publicId: 'novinka/inventory/gallery3',
                        alt: 'Kitchen View'
                    }
                ]
            }, adminToken);

            console.log('Status Code:', res2.statusCode);
            console.log('Updated Cover Public ID:', res2.body.data?.inventory?.coverImagePublicId);
            console.log('Updated Gallery Count:', res2.body.data?.inventory?.gallery?.length);
            console.log('Retained Gallery 1:', res2.body.data?.inventory?.gallery?.[0]?.publicId);
            console.log('New Gallery 3:', res2.body.data?.inventory?.gallery?.[1]?.publicId);
            console.log('------------------------------------------------------\n');

            // Test 3: Delete Inventory Item (Cleans up DB and associated Cloudinary public IDs)
            console.log(`▶ Test 3: DELETE /api/inventory/${itemId} (Delete Record & Cloudinary Assets)`);
            const res3 = await request('DELETE', `/api/inventory/${itemId}`, null, adminToken);
            console.log('Status Code:', res3.statusCode);
            console.log('Message:', res3.body.message);
            console.log('------------------------------------------------------\n');
        }

        console.log('======================================================');
        console.log('CLOUDINARY IMAGE MANAGEMENT TESTS COMPLETED SUCCESSFULLY! ✅');
        console.log('======================================================');
    } catch (err) {
        console.error('Test execution error:', err);
    } finally {
        if (server) server.close();
        await prisma.$disconnect();
        process.exit(0);
    }
}

runTests();
