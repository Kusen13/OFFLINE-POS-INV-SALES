-- ============================================================
-- MIGRATION: Add missing product columns + sell_by_weight
-- Run this once on any existing pos_system database
-- Safe to run multiple times (uses IF NOT EXISTS pattern)
-- Date: 2026-10-26
-- ============================================================

USE `pos_system`;

-- 1. item_type (Product vs Supply)
ALTER TABLE `products`
  MODIFY COLUMN `current_stock` DECIMAL(12,3) NOT NULL DEFAULT 0.000 COMMENT 'Decimal for by-weight items (kg)',
  MODIFY COLUMN `initial_stock` DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  MODIFY COLUMN `low_stock_threshold` DECIMAL(12,3) NOT NULL DEFAULT 10.000;

-- 2. Add new columns (each wrapped in a procedure to skip if already exists)
SET @dbname = DATABASE();

-- item_type
SET @col = 'item_type';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'products' AND COLUMN_NAME = @col) = 0,
  "ALTER TABLE `products` ADD COLUMN `item_type` ENUM('product','supply') NOT NULL DEFAULT 'product' AFTER `description`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- target_stock
SET @col = 'target_stock';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'products' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE `products` ADD COLUMN `target_stock` DECIMAL(12,3) NOT NULL DEFAULT 20.000 COMMENT \'Ideal par/prep level\' AFTER `low_stock_threshold`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- unit
SET @col = 'unit';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'products' AND COLUMN_NAME = @col) = 0,
  "ALTER TABLE `products` ADD COLUMN `unit` VARCHAR(20) NOT NULL DEFAULT 'sticks' COMMENT 'kg, g, pcs, sticks, tali, bundle, puso, sako, lata, bottle, pack' AFTER `target_stock`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sell_by_weight  ← THE KEY NEW COLUMN
SET @col = 'sell_by_weight';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'products' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE `products` ADD COLUMN `sell_by_weight` TINYINT(1) NOT NULL DEFAULT 0 COMMENT \'1 = POS weight modal; price = selling_price × entered weight\' AFTER `unit`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- supplier_id
SET @col = 'supplier_id';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'products' AND COLUMN_NAME = @col) = 0,
  "ALTER TABLE `products` ADD COLUMN `supplier_id` VARCHAR(36) DEFAULT NULL COMMENT 'UUID of linked supplier' AFTER `sell_by_weight`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- supplier_name
SET @col = 'supplier_name';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'products' AND COLUMN_NAME = @col) = 0,
  "ALTER TABLE `products` ADD COLUMN `supplier_name` VARCHAR(150) DEFAULT NULL COMMENT 'Denormalized supplier name' AFTER `supplier_id`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- reseller_price
SET @col = 'reseller_price';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'products' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE `products` ADD COLUMN `reseller_price` DECIMAL(12,2) DEFAULT NULL COMMENT \'Wholesale/reseller price per unit\' AFTER `supplier_name`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- sale_items: add weight columns (optional, for reporting)
SET @col = 'sell_by_weight';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'sale_items' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE `sale_items` ADD COLUMN `sell_by_weight` TINYINT(1) NOT NULL DEFAULT 0 AFTER `line_total`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'weight_value';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'sale_items' AND COLUMN_NAME = @col) = 0,
  'ALTER TABLE `sale_items` ADD COLUMN `weight_value` DECIMAL(10,3) DEFAULT NULL COMMENT \'Actual entered weight (e.g. 1.5)\' AFTER `sell_by_weight`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = 'weight_unit';
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'sale_items' AND COLUMN_NAME = @col) = 0,
  "ALTER TABLE `sale_items` ADD COLUMN `weight_unit` VARCHAR(10) DEFAULT NULL COMMENT 'kg, g, tali, etc.' AFTER `weight_value`",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Also allow decimal quantity in sale_items for by-weight items
ALTER TABLE `sale_items` MODIFY COLUMN `quantity` DECIMAL(12,3) NOT NULL DEFAULT 1.000;

-- Add index for item_type if missing
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'products' AND INDEX_NAME = 'idx_products_item_type') = 0,
  'ALTER TABLE `products` ADD INDEX `idx_products_item_type` (`item_type`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration complete! All columns added successfully.' AS status;
