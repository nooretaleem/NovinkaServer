const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Inspecting MySQL database table "inventory"...');
    const columns = await prisma.$queryRawUnsafe('DESCRIBE inventory');
    console.log('✅ Inventory table columns in MySQL:');
    console.table(columns);
    
    const indexes = await prisma.$queryRawUnsafe('SHOW INDEX FROM inventory');
    console.log('✅ Inventory table indexes in MySQL:');
    console.table(indexes.map(i => ({ Key_name: i.Key_name, Column_name: i.Column_name })));
}

main()
    .catch(e => {
        console.error('Error describing inventory table:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
