-- ============================================================
-- OFFLINE-FIRST POS, INVENTORY & SALES TRACKING SYSTEM
-- Database Schema - MariaDB 10.4+
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- Create database
CREATE DATABASE IF NOT EXISTS `pos_system`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `pos_system`;

-- ============================================================
-- CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `sort_order` INT UNSIGNED NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_categories_name` (`name`),
  KEY `idx_categories_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS `products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `sku` VARCHAR(50) NOT NULL,
  `description` TEXT DEFAULT NULL,
  `cost_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `selling_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `current_stock` INT NOT NULL DEFAULT 0,
  `initial_stock` INT NOT NULL DEFAULT 0,
  `initial_stock_date` DATE DEFAULT NULL,
  `low_stock_threshold` INT UNSIGNED NOT NULL DEFAULT 10,
  `image_path` VARCHAR(255) DEFAULT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_products_sku` (`sku`),
  KEY `idx_products_category` (`category_id`),
  KEY `idx_products_active` (`is_active`),
  KEY `idx_products_stock` (`current_stock`, `low_stock_threshold`),
  KEY `idx_products_updated` (`updated_at`),
  CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`)
    REFERENCES `categories` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- PAYMENT METHODS
-- ============================================================
CREATE TABLE IF NOT EXISTS `payment_methods` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_payment_methods_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SALES
-- ============================================================
CREATE TABLE IF NOT EXISTS `sales` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `uuid` CHAR(36) NOT NULL COMMENT 'UUID generated on mobile device',
  `receipt_number` VARCHAR(30) NOT NULL,
  `subtotal` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `discount_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `tax_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `cash_tendered` DECIMAL(12,2) DEFAULT NULL,
  `change_amount` DECIMAL(12,2) DEFAULT NULL,
  `payment_method_id` INT UNSIGNED NOT NULL,
  `payment_reference` VARCHAR(100) DEFAULT NULL COMMENT 'GCash ref number, etc.',
  `source_device` VARCHAR(100) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `sold_at` DATETIME NOT NULL COMMENT 'Original sale time on device',
  `synced_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sales_uuid` (`uuid`),
  UNIQUE KEY `uk_sales_receipt` (`receipt_number`),
  KEY `idx_sales_sold_at` (`sold_at`),
  KEY `idx_sales_synced_at` (`synced_at`),
  KEY `idx_sales_payment` (`payment_method_id`),
  CONSTRAINT `fk_sales_payment_method` FOREIGN KEY (`payment_method_id`)
    REFERENCES `payment_methods` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SALE ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS `sale_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sale_id` INT UNSIGNED NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `product_name` VARCHAR(150) NOT NULL COMMENT 'Snapshot at time of sale',
  `product_sku` VARCHAR(50) NOT NULL COMMENT 'Snapshot at time of sale',
  `unit_price` DECIMAL(12,2) NOT NULL COMMENT 'Selling price snapshot',
  `unit_cost` DECIMAL(12,2) NOT NULL COMMENT 'Cost price snapshot',
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `line_total` DECIMAL(12,2) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sale_items_sale` (`sale_id`),
  KEY `idx_sale_items_product` (`product_id`),
  CONSTRAINT `fk_sale_items_sale` FOREIGN KEY (`sale_id`)
    REFERENCES `sales` (`id`) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_sale_items_product` FOREIGN KEY (`product_id`)
    REFERENCES `products` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- INVENTORY MOVEMENTS (Audit Trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS `inventory_movements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NOT NULL,
  `type` ENUM('STOCK_IN', 'SALE', 'ADJUSTMENT', 'RETURN', 'INITIAL') NOT NULL,
  `quantity_change` INT NOT NULL COMMENT 'Positive for in, negative for out',
  `stock_before` INT NOT NULL,
  `stock_after` INT NOT NULL,
  `reference_type` VARCHAR(50) DEFAULT NULL COMMENT 'sale, stock_receipt, manual',
  `reference_id` INT UNSIGNED DEFAULT NULL,
  `notes` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inv_movements_product` (`product_id`),
  KEY `idx_inv_movements_type` (`type`),
  KEY `idx_inv_movements_ref` (`reference_type`, `reference_id`),
  KEY `idx_inv_movements_created` (`created_at`),
  CONSTRAINT `fk_inv_movements_product` FOREIGN KEY (`product_id`)
    REFERENCES `products` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- STOCK RECEIPTS (Incoming Stock Batches)
-- ============================================================
CREATE TABLE IF NOT EXISTS `stock_receipts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `receipt_ref` VARCHAR(50) DEFAULT NULL,
  `supplier` VARCHAR(150) DEFAULT NULL,
  `notes` TEXT DEFAULT NULL,
  `total_items` INT UNSIGNED NOT NULL DEFAULT 0,
  `received_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_stock_receipts_received` (`received_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- STOCK RECEIPT ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS `stock_receipt_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `stock_receipt_id` INT UNSIGNED NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `quantity` INT UNSIGNED NOT NULL,
  `unit_cost` DECIMAL(12,2) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sr_items_receipt` (`stock_receipt_id`),
  KEY `idx_sr_items_product` (`product_id`),
  CONSTRAINT `fk_sr_items_receipt` FOREIGN KEY (`stock_receipt_id`)
    REFERENCES `stock_receipts` (`id`) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT `fk_sr_items_product` FOREIGN KEY (`product_id`)
    REFERENCES `products` (`id`) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- EXPENSES
-- ============================================================
CREATE TABLE IF NOT EXISTS `expenses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category` VARCHAR(100) NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `expense_date` DATE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_expenses_date` (`expense_date`),
  KEY `idx_expenses_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SYNC LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS `sync_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `transaction_uuid` CHAR(36) NOT NULL,
  `device_id` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('RECEIVED', 'PROCESSED', 'FAILED', 'DUPLICATE') NOT NULL,
  `request_summary` TEXT DEFAULT NULL COMMENT 'Summary of request, not full payload',
  `error_message` TEXT DEFAULT NULL,
  `items_count` INT UNSIGNED DEFAULT 0,
  `total_amount` DECIMAL(12,2) DEFAULT NULL,
  `synced_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sync_logs_uuid` (`transaction_uuid`),
  KEY `idx_sync_logs_status` (`status`),
  KEY `idx_sync_logs_device` (`device_id`),
  KEY `idx_sync_logs_synced` (`synced_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SETTINGS (Key-Value store for app config)
-- ============================================================
CREATE TABLE IF NOT EXISTS `settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key_name` VARCHAR(100) NOT NULL,
  `value` TEXT DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_settings_key` (`key_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- DAILY CLOSINGS & CASH BALANCING
-- ============================================================
CREATE TABLE IF NOT EXISTS `daily_closings` (
  `id` VARCHAR(64) NOT NULL,
  `date` DATE NOT NULL,
  `status` ENUM('DRAFT', 'FINALIZED') NOT NULL DEFAULT 'DRAFT',
  `total_prepared` INT NOT NULL DEFAULT 0,
  `total_sold` INT NOT NULL DEFAULT 0,
  `total_unsold` INT NOT NULL DEFAULT 0,
  `total_spoilage` INT NOT NULL DEFAULT 0,
  `total_spoilage_loss` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_revenue` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_cogs` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_gross_profit` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `opening_cash` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `cash_sales` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `cash_expenses` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `bills_allocation` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `expected_cash_on_hand` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `actual_cash_on_hand` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `cash_discrepancy` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `notes` TEXT DEFAULT NULL,
  `items_data` LONGTEXT NOT NULL,
  `finalized_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_daily_closings_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- BBQ RE-ORDERS & SUPPLIES REPLENISHMENT
-- ============================================================
CREATE TABLE IF NOT EXISTS `reorders` (
  `id` VARCHAR(64) NOT NULL,
  `order_date` DATE NOT NULL,
  `based_on_date` DATE DEFAULT NULL,
  `status` ENUM('DRAFT', 'ORDERED', 'RECEIVED') NOT NULL DEFAULT 'DRAFT',
  `total_quantity` INT NOT NULL DEFAULT 0,
  `total_cost` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `supplier_name` VARCHAR(100) DEFAULT 'BBQ Supplier',
  `notes` TEXT DEFAULT NULL,
  `items_data` LONGTEXT NOT NULL,
  `received_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_reorders_date` (`order_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- DEFAULT DATA
-- ============================================================

-- Default payment methods
INSERT INTO `payment_methods` (`name`, `is_active`, `sort_order`) VALUES
  ('Cash', 1, 1),
  ('GCash', 1, 2)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- Default settings
INSERT INTO `settings` (`key_name`, `value`) VALUES
  ('store_name', 'My Store'),
  ('currency', 'PHP'),
  ('currency_symbol', '₱'),
  ('tax_rate', '0'),
  ('receipt_footer', 'Thank you for your purchase!'),
  ('low_stock_default', '10')
ON DUPLICATE KEY UPDATE `key_name` = VALUES(`key_name`);

SET FOREIGN_KEY_CHECKS = 1;
