const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const categories = await prisma.categories.findMany({
    select: { id: true, name: true }
  });
  const products = await prisma.products.findMany({
    select: { id: true, name: true, sku: true, selling_price: true, current_stock: true }
  });
  console.log('Categories in DB:', categories);
  console.log('Products in DB:', products);
}

main().finally(() => prisma.$disconnect());
