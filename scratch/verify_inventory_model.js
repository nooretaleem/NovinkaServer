const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Available Prisma Model Keys:', Object.keys(prisma).filter(k => !k.startsWith('_') && !k.startsWith('$')));
    
    if (prisma.inventory) {
        const count = await prisma.inventory.count();
        console.log('✅ Success! Prisma.inventory count:', count);
    } else {
        console.error('❌ prisma.inventory is not defined yet.');
    }
}

main()
    .catch((e) => {
        console.error('Error in verification:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
