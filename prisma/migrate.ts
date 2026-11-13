import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  console.log("Running migration to add missing columns...");
  const db = prisma as any;

  const migrations = [
    `ALTER TABLE products MODIFY COLUMN current_stock DECIMAL(12,3) NOT NULL DEFAULT 0.000`,
    `ALTER TABLE products MODIFY COLUMN initial_stock DECIMAL(12,3) NOT NULL DEFAULT 0.000`,
    `ALTER TABLE products MODIFY COLUMN low_stock_threshold DECIMAL(12,3) NOT NULL DEFAULT 10.000`,
  ];

  const conditionalCols = [
    { col: "item_type",      sql: "ALTER TABLE products ADD COLUMN item_type VARCHAR(10) NOT NULL DEFAULT 'product' AFTER description" },
    { col: "initial_stock_date", sql: "ALTER TABLE products ADD COLUMN initial_stock_date DATE DEFAULT NULL AFTER initial_stock" },
    { col: "target_stock",  sql: "ALTER TABLE products ADD COLUMN target_stock DECIMAL(12,3) NOT NULL DEFAULT 20.000 AFTER low_stock_threshold" },
    { col: "unit",          sql: "ALTER TABLE products ADD COLUMN unit VARCHAR(20) NOT NULL DEFAULT 'sticks' AFTER target_stock" },
    { col: "sell_by_weight",sql: "ALTER TABLE products ADD COLUMN sell_by_weight TINYINT(1) NOT NULL DEFAULT 0 AFTER unit" },
    { col: "supplier_id",   sql: "ALTER TABLE products ADD COLUMN supplier_id VARCHAR(36) DEFAULT NULL AFTER sell_by_weight" },
    { col: "supplier_name", sql: "ALTER TABLE products ADD COLUMN supplier_name VARCHAR(150) DEFAULT NULL AFTER supplier_id" },
    { col: "reseller_price",sql: "ALTER TABLE products ADD COLUMN reseller_price DECIMAL(12,2) DEFAULT NULL AFTER supplier_name" },
  ];

  // Run mandatory MODIFY columns
  for (const sql of migrations) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log("OK:", sql.substring(0, 60));
    } catch (e: any) {
      console.warn("Skip (already done?):", e.message.substring(0, 80));
    }
  }

  // Run conditional ADD COLUMN (check if exists first)
  for (const { col, sql } of conditionalCols) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = ?`,
      col
    ) as any[];
    const exists = Number(rows[0]?.cnt ?? 0) > 0;
    if (!exists) {
      await prisma.$executeRawUnsafe(sql);
      console.log("Added column:", col);
    } else {
      console.log("Column already exists:", col);
    }
  }

  console.log("\nMigration complete!");
}

main()
  .catch((e) => { console.error("Migration failed:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
