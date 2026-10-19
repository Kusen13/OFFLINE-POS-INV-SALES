-- ============================================================
-- SEED DATA - Sample products for testing
-- ============================================================

USE `pos_system`;

-- Categories
INSERT INTO `categories` (`name`, `description`, `sort_order`, `is_active`) VALUES
  ('Coffee', 'Hot and iced coffee drinks', 1, 1),
  ('Tea', 'Hot and iced tea beverages', 2, 1),
  ('Pastries', 'Freshly baked goods', 3, 1),
  ('Snacks', 'Light bites and snacks', 4, 1),
  ('Beverages', 'Non-coffee drinks', 5, 1),
  ('Meals', 'Rice meals and combos', 6, 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- Products
INSERT INTO `products` (`category_id`, `name`, `sku`, `cost_price`, `selling_price`, `current_stock`, `low_stock_threshold`, `is_active`) VALUES
  -- Coffee (category 1)
  (1, 'Americano', 'COF-001', 25.00, 85.00, 100, 20, 1),
  (1, 'Cappuccino', 'COF-002', 30.00, 95.00, 100, 20, 1),
  (1, 'Cafe Latte', 'COF-003', 30.00, 99.00, 100, 20, 1),
  (1, 'Espresso', 'COF-004', 20.00, 75.00, 100, 20, 1),
  (1, 'Mocha', 'COF-005', 35.00, 110.00, 80, 15, 1),
  (1, 'Iced Coffee', 'COF-006', 22.00, 79.00, 100, 20, 1),
  (1, 'Caramel Macchiato', 'COF-007', 38.00, 120.00, 60, 15, 1),

  -- Tea (category 2)
  (2, 'Green Tea', 'TEA-001', 15.00, 65.00, 80, 15, 1),
  (2, 'Milk Tea', 'TEA-002', 25.00, 85.00, 80, 15, 1),
  (2, 'Matcha Latte', 'TEA-003', 35.00, 110.00, 60, 10, 1),
  (2, 'Chai Latte', 'TEA-004', 30.00, 95.00, 60, 10, 1),

  -- Pastries (category 3)
  (3, 'Croissant', 'PAS-001', 25.00, 65.00, 30, 10, 1),
  (3, 'Chocolate Muffin', 'PAS-002', 20.00, 55.00, 40, 10, 1),
  (3, 'Blueberry Scone', 'PAS-003', 22.00, 60.00, 25, 8, 1),
  (3, 'Cinnamon Roll', 'PAS-004', 28.00, 75.00, 20, 8, 1),
  (3, 'Banana Bread', 'PAS-005', 18.00, 50.00, 35, 10, 1),

  -- Snacks (category 4)
  (4, 'Sandwich', 'SNK-001', 35.00, 85.00, 25, 8, 1),
  (4, 'Chicken Wrap', 'SNK-002', 40.00, 95.00, 20, 8, 1),
  (4, 'Cheese Sticks', 'SNK-003', 15.00, 45.00, 50, 15, 1),
  (4, 'Potato Chips', 'SNK-004', 12.00, 35.00, 60, 15, 1),

  -- Beverages (category 5)
  (5, 'Bottled Water', 'BEV-001', 8.00, 25.00, 100, 20, 1),
  (5, 'Orange Juice', 'BEV-002', 20.00, 55.00, 40, 10, 1),
  (5, 'Lemonade', 'BEV-003', 18.00, 50.00, 40, 10, 1),
  (5, 'Mango Shake', 'BEV-004', 30.00, 85.00, 30, 10, 1),

  -- Meals (category 6)
  (6, 'Chicken Rice Bowl', 'MEL-001', 55.00, 130.00, 20, 5, 1),
  (6, 'Beef Tapa Meal', 'MEL-002', 65.00, 150.00, 15, 5, 1),
  (6, 'Pork Sisig', 'MEL-003', 50.00, 120.00, 15, 5, 1),
  (6, 'Spaghetti', 'MEL-004', 35.00, 89.00, 25, 8, 1)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- Create initial inventory movements for all seeded products
INSERT INTO `inventory_movements` (`product_id`, `type`, `quantity_change`, `stock_before`, `stock_after`, `reference_type`, `notes`)
SELECT
  `id`,
  'INITIAL',
  `current_stock`,
  0,
  `current_stock`,
  'manual',
  'Initial stock from seed data'
FROM `products`;
