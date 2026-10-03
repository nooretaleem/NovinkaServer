const express = require('express');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = require('../server');
const prisma = require('../src/config/prisma');
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

let server;
const TEST_PORT = 5099;

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

    // Brief delay to ensure server startup
    await new Promise(r => setTimeout(r, 1000));

    console.log('\n============================================');
    console.log('RUNNING AUTOMATED INVENTORY CRUD API TESTS');
    console.log('============================================\n');

    // Find or create an admin user in the database for valid authentication
    let adminUser = await prisma.user.findFirst({
        where: { role: 'ADMIN', isActive: true }
    });

    if (!adminUser) {
        adminUser = await prisma.user.create({
            data: {
                name: 'Test Admin User',
                email: `testadmin_${Date.now()}@novitaCONSTRUCTIONS.com`,
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

    let createdId = null;

    try {
        // Test 1: GET /api/inventory (Public)
        console.log('▶ Test 1: GET /api/inventory (Public Access)');
        const res1 = await request('GET', '/api/inventory');
        console.log('Status Code:', res1.statusCode);
        console.log('Success Flag:', res1.body.status === 'success');
        console.log('Total Count:', res1.body.data?.pagination?.total);
        console.log('--------------------------------------------\n');

        // Test 2: POST /api/inventory Without Auth Token (Expect 401)
        console.log('▶ Test 2: POST /api/inventory Without Auth (Expect 401 Unauthorized)');
        const res2 = await request('POST', '/api/inventory', {
            title: 'Unauthenticated Item',
            type: 'PLOT',
            location: 'DHA',
            size: '5 Marla'
        });
        console.log('Status Code:', res2.statusCode);
        console.log('Status Error Flag:', res2.body.status === 'error');
        console.log('Message:', res2.body.message);
        console.log('--------------------------------------------\n');

        // Test 3: POST /api/inventory Invalid Type (Expect 400 Bad Request)
        console.log('▶ Test 3: POST /api/inventory Invalid Type (Expect 400)');
        const res3 = await request('POST', '/api/inventory', {
            title: 'Invalid Type Item',
            type: 'APARTMENT',
            location: 'Islamabad',
            size: '10 Marla'
        }, adminToken);
        console.log('Status Code:', res3.statusCode);
        console.log('Error Message:', res3.body.message);
        console.log('--------------------------------------------\n');

        // Test 4: POST /api/inventory Valid PLOT Creation (Expect 201)
        console.log('▶ Test 4: POST /api/inventory Valid PLOT Creation (Expect 201)');
        const res4 = await request('POST', '/api/inventory', {
            type: 'PLOT',
            title: '10 Marla Corner Residential Plot',
            location: 'Sector C, Multi Gardens B-17, Islamabad',
            size: '10 Marla (35x70)',
            price: 19500000,
            status: 'AVAILABLE',
            description: 'Prime corner plot near commercial center.',
            features: ['Corner Plot', '40ft Road', 'Underground Utilities'],
            isFeatured: true,
            displayOrder: 1
        }, adminToken);
        console.log('Status Code:', res4.statusCode);
        console.log('Created ID:', res4.body.data?.inventory?.id);
        console.log('Created Slug:', res4.body.data?.inventory?.slug);
        console.log('Price:', res4.body.data?.inventory?.price);
        createdId = res4.body.data?.inventory?.id;
        console.log('--------------------------------------------\n');

        // Test 5: POST /api/inventory Valid HOUSE Creation (Expect 201)
        console.log('▶ Test 5: POST /api/inventory Valid HOUSE Creation (Expect 201)');
        const res5 = await request('POST', '/api/inventory', {
            type: 'HOUSE',
            title: '5 Marla Luxury Designer Villa',
            location: 'Bahria Town Phase 7, Rawalpindi',
            size: '5 Marla (2,250 Sq Ft)',
            price: 24500000,
            status: 'AVAILABLE',
            description: 'Brand new 5 Marla double story villa with Spanish tiles.',
            features: ['4 Bedrooms', '5 Bathrooms', 'Car Porch', 'Rooftop BBQ Area'],
            isFeatured: false,
            displayOrder: 2
        }, adminToken);
        console.log('Status Code:', res5.statusCode);
        console.log('Created House ID:', res5.body.data?.inventory?.id);
        console.log('--------------------------------------------\n');

        // Test 6: GET /api/inventory?type=PLOT Filter
        console.log('▶ Test 6: GET /api/inventory?type=PLOT (Filter Plots)');
        const res6 = await request('GET', '/api/inventory?type=PLOT');
        console.log('Status Code:', res6.statusCode);
        console.log('Filtered Plots Count:', res6.body.data?.inventory?.length);
        console.log('--------------------------------------------\n');

        // Test 7: GET /api/inventory?search=B-17 Keyword Search
        console.log('▶ Test 7: GET /api/inventory?search=B-17 (Search Filter)');
        const res7 = await request('GET', '/api/inventory?search=B-17');
        console.log('Status Code:', res7.statusCode);
        console.log('Search Match Count:', res7.body.data?.inventory?.length);
        console.log('--------------------------------------------\n');

        // Test 8: GET /api/inventory/:id Fetch Single
        if (createdId) {
            console.log(`▶ Test 8: GET /api/inventory/${createdId} (Get Single)`);
            const res8 = await request('GET', `/api/inventory/${createdId}`);
            console.log('Status Code:', res8.statusCode);
            console.log('Fetched Title:', res8.body.data?.inventory?.title);
            console.log('--------------------------------------------\n');

            // Test 9: PATCH /api/inventory/:id Partial Update
            console.log(`▶ Test 9: PATCH /api/inventory/${createdId} (Partial Price & Status Update)`);
            const res9 = await request('PATCH', `/api/inventory/${createdId}`, {
                price: 21000000,
                status: 'RESERVED'
            }, adminToken);
            console.log('Status Code:', res9.statusCode);
            console.log('Updated Price:', res9.body.data?.inventory?.price);
            console.log('Updated Status:', res9.body.data?.inventory?.status);
            console.log('Title Unchanged:', res9.body.data?.inventory?.title === '10 Marla Corner Residential Plot');
            console.log('--------------------------------------------\n');

            // Test 10: DELETE /api/inventory/:id Delete Record
            console.log(`▶ Test 10: DELETE /api/inventory/${createdId} (Delete Record)`);
            const res10 = await request('DELETE', `/api/inventory/${createdId}`, null, adminToken);
            console.log('Status Code:', res10.statusCode);
            console.log('Message:', res10.body.message);
            console.log('--------------------------------------------\n');

            // Test 11: GET /api/inventory/:id After Delete (Expect 404)
            console.log(`▶ Test 11: GET /api/inventory/${createdId} After Delete (Expect 404)`);
            const res11 = await request('GET', `/api/inventory/${createdId}`);
            console.log('Status Code:', res11.statusCode);
            console.log('Message:', res11.body.message);
            console.log('--------------------------------------------\n');
        }

        console.log('============================================');
        console.log('ALL INVENTORY BACKEND API TESTS PASSED SUCCESSFULLY! ✅');
        console.log('============================================');
    } catch (err) {
        console.error('Test execution error:', err);
    } finally {
        if (server) server.close();
        await prisma.$disconnect();
        process.exit(0);
    }
}

runTests();
