<?php
/**
 * Sync Controller
 * Handles mobile-to-server synchronization
 * 
 * POST /api/sync/sales   - Receive batch of sales from mobile device
 * GET  /api/sync/products - Send product catalog updates to mobile device
 * GET  /api/sync/status   - Return sync health and counts
 */

function handleSync(string $method, ?string $action): void {
    $pdo = getDBConnection();

    switch ($action) {
        case 'sales':
            if ($method === 'POST') {
                syncSalesFromDevice($pdo);
            } else {
                jsonMethodNotAllowed();
            }
            break;

        case 'products':
            if ($method === 'GET') {
                syncProductsToDevice($pdo);
            } else {
                jsonMethodNotAllowed();
            }
            break;

        case 'mutations':
            if ($method === 'POST') {
                syncMutationsFromDevice($pdo);
            } else {
                jsonMethodNotAllowed();
            }
            break;

        case 'expenses':
            if ($method === 'GET') {
                syncExpensesToDevice($pdo);
            } else {
                jsonMethodNotAllowed();
            }
            break;

        case 'status':
            if ($method === 'GET') {
                getSyncStatus($pdo);
            } else {
                jsonMethodNotAllowed();
            }
            break;

        default:
            jsonNotFound('Unknown sync action');
    }
}

/**
 * Receive batch of sales from mobile device.
 * 
 * Each sale is processed individually within a transaction.
 * Duplicate UUIDs are detected and returned as success (idempotent).
 * Inventory is decremented atomically with each sale.
 * 
 * Expected body: { sales: [ { uuid, receipt_number, items: [...], ... } ] }
 */
function syncSalesFromDevice(PDO $pdo): void {
    $data = getJsonBody();
    $deviceId = $_SERVER['HTTP_X_DEVICE_ID'] ?? 'unknown';

    if (!isset($data['sales']) || !is_array($data['sales'])) {
        jsonError('Request must contain a "sales" array', 400);
    }

    $results = [
        'synced' => [],
        'duplicates' => [],
        'failed' => [],
    ];

    foreach ($data['sales'] as $index => $saleData) {
        try {
            $result = processSingleSale($pdo, $saleData, $deviceId);
            
            if ($result['status'] === 'synced') {
                $results['synced'][] = $result;
            } elseif ($result['status'] === 'duplicate') {
                $results['duplicates'][] = $result;
            }
        } catch (Throwable $e) {
            error_log("Sync failed for sale index $index: " . $e->getMessage());
            $results['failed'][] = [
                'uuid' => $saleData['uuid'] ?? 'unknown',
                'receipt_number' => $saleData['receipt_number'] ?? 'unknown',
                'error' => $e->getMessage(),
            ];

            // Log failure
            try {
                logSync($pdo, $saleData['uuid'] ?? 'unknown', $deviceId, 'FAILED', $saleData, $e->getMessage());
            } catch (Throwable $logError) {
                error_log("Failed to log sync error: " . $logError->getMessage());
            }
        }
    }

    jsonResponse([
        'synced_count' => count($results['synced']),
        'duplicate_count' => count($results['duplicates']),
        'failed_count' => count($results['failed']),
        'synced' => $results['synced'],
        'duplicates' => $results['duplicates'],
        'failed' => $results['failed'],
        'server_time' => date('c'),
    ]);
}

/**
 * Process a single sale within a transaction
 */
function processSingleSale(PDO $pdo, array $saleData, string $deviceId): array {
    // Validate UUID
    if (empty($saleData['uuid']) || !isValidUuid($saleData['uuid'])) {
        throw new \InvalidArgumentException('Invalid or missing UUID');
    }

    // Check for duplicate (idempotent)
    $stmt = $pdo->prepare('SELECT id, receipt_number FROM sales WHERE uuid = :uuid');
    $stmt->execute([':uuid' => $saleData['uuid']]);
    $existing = $stmt->fetch();

    if ($existing) {
        // Already processed — return success without re-inserting
        logSync($pdo, $saleData['uuid'], $deviceId, 'DUPLICATE', $saleData, null);
        return [
            'status' => 'duplicate',
            'uuid' => $saleData['uuid'],
            'receipt_number' => $existing['receipt_number'],
            'server_id' => (int) $existing['id'],
        ];
    }

    // Validate required fields
    $requiredFields = ['receipt_number', 'items', 'total_amount', 'payment_method_id', 'sold_at'];
    foreach ($requiredFields as $field) {
        if (!isset($saleData[$field])) {
            throw new \InvalidArgumentException("Missing required field: $field");
        }
    }

    if (!is_array($saleData['items']) || count($saleData['items']) === 0) {
        throw new \InvalidArgumentException('Sale must contain at least one item');
    }

    // Begin transaction
    $pdo->beginTransaction();

    try {
        // Insert sale
        $stmt = $pdo->prepare(
            'INSERT INTO sales (uuid, receipt_number, subtotal, discount_amount, tax_amount, total_amount, 
                               cash_tendered, change_amount, payment_method_id, payment_reference,
                               source_device, notes, sold_at, synced_at) 
             VALUES (:uuid, :receipt, :subtotal, :discount, :tax, :total, 
                     :cash, :change, :payment_id, :payment_ref,
                     :device, :notes, :sold_at, NOW())'
        );

        $stmt->execute([
            ':uuid' => $saleData['uuid'],
            ':receipt' => sanitizeString($saleData['receipt_number']),
            ':subtotal' => sanitizeDecimal($saleData['subtotal'] ?? $saleData['total_amount']),
            ':discount' => sanitizeDecimal($saleData['discount_amount'] ?? 0),
            ':tax' => sanitizeDecimal($saleData['tax_amount'] ?? 0),
            ':total' => sanitizeDecimal($saleData['total_amount']),
            ':cash' => sanitizeDecimal($saleData['cash_tendered'] ?? null),
            ':change' => sanitizeDecimal($saleData['change_amount'] ?? null),
            ':payment_id' => sanitizeInt($saleData['payment_method_id']),
            ':payment_ref' => sanitizeString($saleData['payment_reference'] ?? null),
            ':device' => sanitizeString($deviceId),
            ':notes' => sanitizeString($saleData['notes'] ?? null),
            ':sold_at' => $saleData['sold_at'],
        ]);

        $saleId = (int) $pdo->lastInsertId();

        // Insert sale items and update inventory
        foreach ($saleData['items'] as $item) {
            if (empty($item['product_id']) || empty($item['quantity'])) {
                throw new \InvalidArgumentException('Each item must have product_id and quantity');
            }

            // Insert sale item with price snapshots
            $stmt = $pdo->prepare(
                'INSERT INTO sale_items (sale_id, product_id, product_name, product_sku, unit_price, unit_cost, quantity, line_total)
                 VALUES (:sale_id, :product_id, :name, :sku, :price, :cost, :qty, :total)'
            );

            $stmt->execute([
                ':sale_id' => $saleId,
                ':product_id' => sanitizeInt($item['product_id']),
                ':name' => sanitizeString($item['product_name'] ?? 'Unknown'),
                ':sku' => sanitizeString($item['product_sku'] ?? ''),
                ':price' => sanitizeDecimal($item['unit_price'] ?? 0),
                ':cost' => sanitizeDecimal($item['unit_cost'] ?? 0),
                ':qty' => sanitizeInt($item['quantity']),
                ':total' => sanitizeDecimal($item['line_total'] ?? ($item['unit_price'] * $item['quantity'])),
            ]);

            // Get current stock for the product
            $stmt = $pdo->prepare('SELECT current_stock FROM products WHERE id = :id FOR UPDATE');
            $stmt->execute([':id' => $item['product_id']]);
            $product = $stmt->fetch();

            if ($product) {
                $stockBefore = (int) $product['current_stock'];
                $quantitySold = (int) $item['quantity'];
                $stockAfter = $stockBefore - $quantitySold;

                // Update stock
                $stmt = $pdo->prepare('UPDATE products SET current_stock = :stock WHERE id = :id');
                $stmt->execute([':stock' => $stockAfter, ':id' => $item['product_id']]);

                // Record inventory movement
                $stmt = $pdo->prepare(
                    'INSERT INTO inventory_movements (product_id, type, quantity_change, stock_before, stock_after, reference_type, reference_id, notes) 
                     VALUES (:product_id, :type, :qty, :before, :after, :ref_type, :ref_id, :notes)'
                );
                $stmt->execute([
                    ':product_id' => $item['product_id'],
                    ':type' => 'SALE',
                    ':qty' => -$quantitySold,
                    ':before' => $stockBefore,
                    ':after' => $stockAfter,
                    ':ref_type' => 'sale',
                    ':ref_id' => $saleId,
                    ':notes' => "Sale #{$saleData['receipt_number']}",
                ]);
            }
        }

        // Automatically credit sold items to Daily Closing for this date (if draft exists)
        $saleDate = substr($saleData['sold_at'], 0, 10);
        if ($saleDate !== '2026-10-19' && $saleDate !== '2026-10-20') {
            creditSaleToDailyClosingDraft($pdo, $saleDate, $saleData['items']);
        }

        $pdo->commit();

        // Log successful sync
        logSync($pdo, $saleData['uuid'], $deviceId, 'PROCESSED', $saleData, null);

        return [
            'status' => 'synced',
            'uuid' => $saleData['uuid'],
            'receipt_number' => $saleData['receipt_number'],
            'server_id' => $saleId,
        ];

    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

/**
 * Automatically credit sold items to Daily Closing for a specific date
 */
function creditSaleToDailyClosingDraft(PDO $pdo, string $saleDate, array $saleItems): void {
    $stmt = $pdo->prepare('SELECT * FROM daily_closings WHERE date = :date FOR UPDATE');
    $stmt->execute([':date' => $saleDate]);
    $closing = $stmt->fetch();
    if (!$closing || $closing['status'] === 'FINALIZED') {
        return;
    }

    $items = json_decode($closing['items_data'], true);
    if (!is_array($items) || empty($items)) {
        return;
    }

    $modified = false;
    foreach ($saleItems as $sItem) {
        $pId = (int)($sItem['product_id'] ?? 0);
        $qty = (int)($sItem['quantity'] ?? 0);
        $pName = trim(strtolower($sItem['product_name'] ?? ''));

        foreach ($items as &$cItem) {
            $cId = (int)($cItem['product_id'] ?? 0);
            $cName = trim(strtolower($cItem['product_name'] ?? ''));
            if ($cId === $pId || ($pName !== '' && $cName === $pName)) {
                $cItem['sold_qty'] = (int)($cItem['sold_qty'] ?? 0) + $qty;
                $prep = (int)($cItem['prepared_qty'] ?? 0);
                $spoil = (int)($cItem['spoilage_qty'] ?? 0);
                $cItem['unsold_qty'] = max(0, $prep - $cItem['sold_qty'] - $spoil);
                $cost = (float)($cItem['unit_cost'] ?? 0);
                $price = (float)($cItem['selling_price'] ?? 0);
                $cItem['actual_revenue'] = $cItem['sold_qty'] * $price;
                $cItem['cogs'] = $cItem['sold_qty'] * $cost;
                $cItem['gross_profit'] = $cItem['actual_revenue'] - $cItem['cogs'];
                $cItem['discrepancy'] = ($cItem['sold_qty'] + $cItem['unsold_qty'] + $spoil) - $prep;
                $modified = true;
                break;
            }
        }
        unset($cItem);
    }

    if ($modified) {
        $totPrep = array_sum(array_column($items, 'prepared_qty'));
        $totSold = array_sum(array_column($items, 'sold_qty'));
        $totUnsold = array_sum(array_column($items, 'unsold_qty'));
        $totSpoil = array_sum(array_column($items, 'spoilage_qty'));
        $totRev = array_sum(array_column($items, 'actual_revenue'));
        $totCogs = array_sum(array_column($items, 'cogs'));
        $totGp = array_sum(array_column($items, 'gross_profit'));

        $openCash = (float)($closing['opening_cash'] ?? 0);
        $exp = (float)($closing['cash_expenses'] ?? 0);
        $bills = (float)($closing['bills_allocation'] ?? 0);
        $expCash = $openCash + $totRev - $exp - $bills;

        $upStmt = $pdo->prepare('UPDATE daily_closings SET
            total_prepared = :prep,
            total_sold = :sold,
            total_unsold = :unsold,
            total_spoilage = :spoil,
            total_revenue = :rev,
            total_cogs = :cogs,
            total_gross_profit = :gp,
            cash_sales = :cash_sales,
            expected_cash_on_hand = :exp_cash,
            items_data = :items
            WHERE date = :date');
        $upStmt->execute([
            ':prep' => $totPrep,
            ':sold' => $totSold,
            ':unsold' => $totUnsold,
            ':spoil' => $totSpoil,
            ':rev' => $totRev,
            ':cogs' => $totCogs,
            ':gp' => $totGp,
            ':cash_sales' => $totRev,
            ':exp_cash' => $expCash,
            ':items' => json_encode($items),
            ':date' => $saleDate,
        ]);
    }
}

/**
 * Log sync attempt
 */
function logSync(PDO $pdo, string $uuid, string $deviceId, string $status, array $data, ?string $error): void {
    $stmt = $pdo->prepare(
        'INSERT INTO sync_logs (transaction_uuid, device_id, status, request_summary, error_message, items_count, total_amount) 
         VALUES (:uuid, :device, :status, :summary, :error, :items, :total)'
    );

    $summary = json_encode([
        'receipt_number' => $data['receipt_number'] ?? null,
        'item_count' => isset($data['items']) ? count($data['items']) : 0,
        'total' => $data['total_amount'] ?? 0,
    ]);

    $stmt->execute([
        ':uuid' => $uuid,
        ':device' => $deviceId,
        ':status' => $status,
        ':summary' => $summary,
        ':error' => $error,
        ':items' => isset($data['items']) ? count($data['items']) : 0,
        ':total' => sanitizeDecimal($data['total_amount'] ?? 0),
    ]);
}

/**
 * Send product catalog updates to mobile device
 * Supports incremental sync via ?since=timestamp
 */
function syncProductsToDevice(PDO $pdo): void {
    $since = getQueryParam('since');
    $sinceDateTime = null;
    if ($since) {
        $ts = strtotime($since);
        if ($ts !== false) {
            $sinceDateTime = date('Y-m-d H:i:s', $ts);
        }
    }

    // Fetch categories
    $catSql = 'SELECT * FROM categories WHERE is_active = 1';
    $catParams = [];
    if ($sinceDateTime) {
        $catSql .= ' AND updated_at > :since';
        $catParams[':since'] = $sinceDateTime;
    }
    $catSql .= ' ORDER BY sort_order ASC, name ASC';
    
    $stmt = $pdo->prepare($catSql);
    $stmt->execute($catParams);
    $categories = $stmt->fetchAll();

    // Fetch products
    $prodSql = 'SELECT p.*, c.name as category_name 
                FROM products p 
                LEFT JOIN categories c ON p.category_id = c.id 
                WHERE p.is_active = 1';
    $prodParams = [];
    if ($sinceDateTime) {
        $prodSql .= ' AND p.updated_at > :since';
        $prodParams[':since'] = $sinceDateTime;
    }
    $prodSql .= ' ORDER BY p.name ASC';

    $stmt = $pdo->prepare($prodSql);
    $stmt->execute($prodParams);
    $products = $stmt->fetchAll();

    // Fetch payment methods
    $stmt = $pdo->query('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY sort_order ASC');
    $paymentMethods = $stmt->fetchAll();

    // Fetch settings
    $stmt = $pdo->query('SELECT key_name, value FROM settings');
    $settings = [];
    while ($row = $stmt->fetch()) {
        $settings[$row['key_name']] = $row['value'];
    }

    // Cast types
    $categories = array_map(function ($c) {
        $c['id'] = (int) $c['id'];
        $c['sort_order'] = (int) $c['sort_order'];
        $c['is_active'] = (bool) $c['is_active'];
        return $c;
    }, $categories);

    $products = array_map(function ($p) {
        $p['id'] = (int) $p['id'];
        $p['category_id'] = (int) $p['category_id'];
        $p['cost_price'] = (float) $p['cost_price'];
        $p['selling_price'] = (float) $p['selling_price'];
        $p['current_stock'] = (int) $p['current_stock'];
        $p['low_stock_threshold'] = (int) $p['low_stock_threshold'];
        $p['target_stock'] = isset($p['target_stock']) ? (int) $p['target_stock'] : 20;
        $p['unit'] = $p['unit'] ?? 'sticks';
        $p['supplier_id'] = $p['supplier_id'] ?? null;
        $p['supplier_name'] = $p['supplier_name'] ?? null;
        $p['reseller_price'] = isset($p['reseller_price']) && $p['reseller_price'] !== null ? (float) $p['reseller_price'] : null;
        $p['is_active'] = (bool) $p['is_active'];
        return $p;
    }, $products);

    $paymentMethods = array_map(function ($pm) {
        $pm['id'] = (int) $pm['id'];
        $pm['is_active'] = (bool) $pm['is_active'];
        $pm['sort_order'] = (int) $pm['sort_order'];
        return $pm;
    }, $paymentMethods);

    jsonResponse([
        'categories' => $categories,
        'products' => $products,
        'payment_methods' => $paymentMethods,
        'settings' => $settings,
        'server_time' => date('c'),
        'is_incremental' => $since !== null,
    ]);
}

/**
 * Get sync status - counts and recent activity
 */
function getSyncStatus(PDO $pdo): void {
    // Total sales count
    $stmt = $pdo->query('SELECT COUNT(*) FROM sales');
    $totalSales = (int) $stmt->fetchColumn();

    // Today's synced count
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM sales WHERE DATE(synced_at) = CURDATE()'
    );
    $stmt->execute();
    $todaySynced = (int) $stmt->fetchColumn();

    // Recent sync logs
    $stmt = $pdo->query(
        'SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 20'
    );
    $recentLogs = $stmt->fetchAll();

    // Failure count in last 24 hours
    $stmt = $pdo->prepare(
        "SELECT COUNT(*) FROM sync_logs WHERE status = 'FAILED' AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)"
    );
    $stmt->execute();
    $recentFailures = (int) $stmt->fetchColumn();

    jsonResponse([
        'total_sales' => $totalSales,
        'today_synced' => $todaySynced,
        'recent_failures' => $recentFailures,
        'recent_logs' => $recentLogs,
        'server_time' => date('c'),
    ]);
}

/**
 * Send all expenses to mobile device for offline cache
 */
function syncExpensesToDevice(PDO $pdo): void {
    $stmt = $pdo->query('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC');
    $expenses = $stmt->fetchAll();

    $expenses = array_map(function ($e) {
        $e['id'] = (int) $e['id'];
        $e['amount'] = (float) $e['amount'];
        return $e;
    }, $expenses);

    jsonResponse([
        'expenses' => $expenses,
        'server_time' => date('c'),
    ]);
}

/**
 * Process offline mutations for Expenses, Categories, and Products
 */
function syncMutationsFromDevice(PDO $pdo): void {
    $data = getJsonBody();
    $mutations = $data['mutations'] ?? [];

    if (!is_array($mutations)) {
        jsonError('Request must contain a "mutations" array', 400);
    }

    $results = [
        'processed' => [],
        'failed' => [],
    ];

    // Maintain a map of temp IDs to real server IDs (e.g. for newly created categories)
    $categoryTempMap = [];

    foreach ($mutations as $m) {
        $uuid = $m['id'] ?? null;
        $entity = $m['entity'] ?? '';
        $action = $m['action'] ?? '';
        $payload = $m['payload'] ?? [];
        $entityId = isset($m['entityId']) ? (int) $m['entityId'] : null;
        $tempId = isset($m['tempId']) ? (int) $m['tempId'] : null;

        try {
            if ($entity === 'expense') {
                if ($action === 'create') {
                    $stmt = $pdo->prepare(
                        'INSERT INTO expenses (category, description, amount, expense_date) 
                         VALUES (:cat, :desc, :amount, :date)'
                    );
                    $stmt->execute([
                        ':cat' => sanitizeString($payload['category'] ?? 'Other'),
                        ':desc' => sanitizeString($payload['description'] ?? ''),
                        ':amount' => sanitizeDecimal($payload['amount'] ?? 0),
                        ':date' => $payload['expense_date'] ?? date('Y-m-d'),
                    ]);
                    $serverId = (int) $pdo->lastInsertId();
                    $results['processed'][] = [
                        'uuid' => $uuid,
                        'tempId' => $tempId,
                        'serverId' => $serverId,
                        'entity' => $entity,
                        'action' => $action,
                    ];
                } elseif ($action === 'update' && $entityId) {
                    $stmt = $pdo->prepare(
                        'UPDATE expenses SET category = :cat, description = :desc, amount = :amount, expense_date = :date 
                         WHERE id = :id'
                    );
                    $stmt->execute([
                        ':cat' => sanitizeString($payload['category'] ?? 'Other'),
                        ':desc' => sanitizeString($payload['description'] ?? ''),
                        ':amount' => sanitizeDecimal($payload['amount'] ?? 0),
                        ':date' => $payload['expense_date'] ?? date('Y-m-d'),
                        ':id' => $entityId,
                    ]);
                    $results['processed'][] = [
                        'uuid' => $uuid,
                        'serverId' => $entityId,
                        'entity' => $entity,
                        'action' => $action,
                    ];
                } elseif ($action === 'delete' && $entityId) {
                    $stmt = $pdo->prepare('DELETE FROM expenses WHERE id = :id');
                    $stmt->execute([':id' => $entityId]);
                    $results['processed'][] = [
                        'uuid' => $uuid,
                        'serverId' => $entityId,
                        'entity' => $entity,
                        'action' => $action,
                    ];
                }
            } elseif ($entity === 'category') {
                if ($action === 'create') {
                    // Check duplicate by name
                    $name = sanitizeString($payload['name'] ?? '');
                    $stmt = $pdo->prepare('SELECT id FROM categories WHERE name = :name');
                    $stmt->execute([':name' => $name]);
                    $existing = $stmt->fetch();

                    if ($existing) {
                        $serverId = (int) $existing['id'];
                    } else {
                        $stmt = $pdo->prepare(
                            'INSERT INTO categories (name, description, sort_order, is_active) 
                             VALUES (:name, :description, :sort_order, 1)'
                        );
                        $stmt->execute([
                            ':name' => $name,
                            ':description' => sanitizeString($payload['description'] ?? null),
                            ':sort_order' => sanitizeInt($payload['sort_order'] ?? 0),
                        ]);
                        $serverId = (int) $pdo->lastInsertId();
                    }

                    if ($tempId !== null) {
                        $categoryTempMap[$tempId] = $serverId;
                    }

                    $results['processed'][] = [
                        'uuid' => $uuid,
                        'tempId' => $tempId,
                        'serverId' => $serverId,
                        'entity' => $entity,
                        'action' => $action,
                    ];
                } elseif ($action === 'update' && $entityId) {
                    $stmt = $pdo->prepare(
                        'UPDATE categories SET name = :name, description = :description, sort_order = :sort_order 
                         WHERE id = :id'
                    );
                    $stmt->execute([
                        ':name' => sanitizeString($payload['name'] ?? ''),
                        ':description' => sanitizeString($payload['description'] ?? null),
                        ':sort_order' => sanitizeInt($payload['sort_order'] ?? 0),
                        ':id' => $entityId,
                    ]);
                    $results['processed'][] = [
                        'uuid' => $uuid,
                        'serverId' => $entityId,
                        'entity' => $entity,
                        'action' => $action,
                    ];
                } elseif ($action === 'delete' && $entityId) {
                    $stmt = $pdo->prepare('UPDATE categories SET is_active = 0 WHERE id = :id');
                    $stmt->execute([':id' => $entityId]);
                    $results['processed'][] = [
                        'uuid' => $uuid,
                        'serverId' => $entityId,
                        'entity' => $entity,
                        'action' => $action,
                    ];
                }
            } elseif ($entity === 'product') {
                if ($action === 'create') {
                    $categoryId = sanitizeInt($payload['category_id'] ?? 0);
                    // If category_id was a temp ID from this batch, map to real server ID
                    if (isset($categoryTempMap[$categoryId])) {
                        $categoryId = $categoryTempMap[$categoryId];
                    }

                    $sku = sanitizeString($payload['sku'] ?? '');
                    // Check duplicate SKU
                    $stmt = $pdo->prepare('SELECT id FROM products WHERE sku = :sku');
                    $stmt->execute([':sku' => $sku]);
                    $existing = $stmt->fetch();

                    if ($existing) {
                        $serverId = (int) $existing['id'];
                    } else {
                        $stmt = $pdo->prepare(
                            'INSERT INTO products (
                                category_id, name, sku, description, cost_price, selling_price, current_stock, 
                                low_stock_threshold, target_stock, unit, supplier_id, supplier_name, reseller_price, is_active
                            ) VALUES (
                                :cat, :name, :sku, :desc, :cost, :price, :stock, 
                                :low, :target_stock, :unit, :supplier_id, :supplier_name, :reseller_price, :active
                            )'
                        );
                        $stmt->execute([
                            ':cat' => $categoryId,
                            ':name' => sanitizeString($payload['name'] ?? ''),
                            ':sku' => $sku,
                            ':desc' => sanitizeString($payload['description'] ?? null),
                            ':cost' => sanitizeDecimal($payload['cost_price'] ?? 0),
                            ':price' => sanitizeDecimal($payload['selling_price'] ?? 0),
                            ':stock' => sanitizeInt($payload['current_stock'] ?? 0),
                            ':low' => sanitizeInt($payload['low_stock_threshold'] ?? 10),
                            ':target_stock' => sanitizeInt($payload['target_stock'] ?? 20),
                            ':unit' => sanitizeString($payload['unit'] ?? 'sticks'),
                            ':supplier_id' => sanitizeString($payload['supplier_id'] ?? null),
                            ':supplier_name' => sanitizeString($payload['supplier_name'] ?? null),
                            ':reseller_price' => isset($payload['reseller_price']) && $payload['reseller_price'] !== '' ? sanitizeDecimal($payload['reseller_price']) : null,
                            ':active' => !empty($payload['is_active']) ? 1 : 0,
                        ]);
                        $serverId = (int) $pdo->lastInsertId();
                    }

                    $results['processed'][] = [
                        'uuid' => $uuid,
                        'tempId' => $tempId,
                        'serverId' => $serverId,
                        'entity' => $entity,
                        'action' => $action,
                    ];
                } elseif ($action === 'update' && $entityId) {
                    $categoryId = sanitizeInt($payload['category_id'] ?? 0);
                    if (isset($categoryTempMap[$categoryId])) {
                        $categoryId = $categoryTempMap[$categoryId];
                    }

                    $stmt = $pdo->prepare(
                        'UPDATE products SET 
                            category_id = :cat, name = :name, sku = :sku, description = :desc, 
                            cost_price = :cost, selling_price = :price, current_stock = :stock, 
                            low_stock_threshold = :low, target_stock = :target_stock, unit = :unit,
                            supplier_id = :supplier_id, supplier_name = :supplier_name, 
                            reseller_price = :reseller_price, is_active = :active 
                         WHERE id = :id'
                    );
                    $stmt->execute([
                        ':cat' => $categoryId,
                        ':name' => sanitizeString($payload['name'] ?? ''),
                        ':sku' => sanitizeString($payload['sku'] ?? ''),
                        ':desc' => sanitizeString($payload['description'] ?? null),
                        ':cost' => sanitizeDecimal($payload['cost_price'] ?? 0),
                        ':price' => sanitizeDecimal($payload['selling_price'] ?? 0),
                        ':stock' => sanitizeInt($payload['current_stock'] ?? 0),
                        ':low' => sanitizeInt($payload['low_stock_threshold'] ?? 10),
                        ':target_stock' => sanitizeInt($payload['target_stock'] ?? 20),
                        ':unit' => sanitizeString($payload['unit'] ?? 'sticks'),
                        ':supplier_id' => sanitizeString($payload['supplier_id'] ?? null),
                        ':supplier_name' => sanitizeString($payload['supplier_name'] ?? null),
                        ':reseller_price' => isset($payload['reseller_price']) && $payload['reseller_price'] !== '' ? sanitizeDecimal($payload['reseller_price']) : null,
                        ':active' => !empty($payload['is_active']) ? 1 : 0,
                        ':id' => $entityId,
                    ]);
                    $results['processed'][] = [
                        'uuid' => $uuid,
                        'serverId' => $entityId,
                        'entity' => $entity,
                        'action' => $action,
                    ];
                } elseif ($action === 'delete' && $entityId) {
                    $stmt = $pdo->prepare('UPDATE products SET is_active = 0 WHERE id = :id');
                    $stmt->execute([':id' => $entityId]);
                    $results['processed'][] = [
                        'uuid' => $uuid,
                        'serverId' => $entityId,
                        'entity' => $entity,
                        'action' => $action,
                    ];
                }
            } elseif ($entity === 'daily_closing') {
                $closingData = $payload;
                $date = $closingData['date'] ?? null;
                if ($date) {
                    $id = $closingData['id'] ?? "closing-{$date}";
                    $status = !empty($closingData['status']) && in_array($closingData['status'], ['DRAFT', 'FINALIZED']) ? $closingData['status'] : 'DRAFT';
                    $items = isset($closingData['items']) ? (is_string($closingData['items']) ? $closingData['items'] : json_encode($closingData['items'])) : '[]';

                    $totalPrepared = (int) ($closingData['total_prepared'] ?? 0);
                    $totalSold = (int) ($closingData['total_sold'] ?? 0);
                    $totalUnsold = (int) ($closingData['total_unsold'] ?? 0);
                    $totalSpoilage = (int) ($closingData['total_spoilage'] ?? 0);
                    $totalSpoilageLoss = (float) ($closingData['total_spoilage_loss'] ?? 0);
                    $totalRevenue = (float) ($closingData['total_revenue'] ?? 0);
                    $totalCogs = (float) ($closingData['total_cogs'] ?? 0);
                    $totalGrossProfit = (float) ($closingData['total_gross_profit'] ?? 0);

                    $openingCash = (float) ($closingData['opening_cash'] ?? 0);
                    $cashSales = (float) ($closingData['cash_sales'] ?? 0);
                    $cashExpenses = (float) ($closingData['cash_expenses'] ?? 0);
                    $billsAllocation = (float) ($closingData['bills_allocation'] ?? 0);
                    $expectedCash = (float) ($closingData['expected_cash_on_hand'] ?? 0);
                    $actualCash = (float) ($closingData['actual_cash_on_hand'] ?? 0);
                    $cashDiscrepancy = (float) ($closingData['cash_discrepancy'] ?? 0);
                    $notes = isset($closingData['notes']) ? sanitizeString($closingData['notes']) : null;
                    $finalizedAt = !empty($closingData['finalized_at']) ? $closingData['finalized_at'] : ($status === 'FINALIZED' ? date('Y-m-d H:i:s') : null);

                    $sql = "INSERT INTO daily_closings (
                        id, date, status, total_prepared, total_sold, total_unsold, total_spoilage,
                        total_spoilage_loss, total_revenue, total_cogs, total_gross_profit,
                        opening_cash, cash_sales, cash_expenses, bills_allocation,
                        expected_cash_on_hand, actual_cash_on_hand, cash_discrepancy,
                        notes, items_data, finalized_at
                    ) VALUES (
                        :id, :date, :status, :tot_prep, :tot_sold, :tot_unsold, :tot_spoil,
                        :tot_spoil_loss, :tot_rev, :tot_cogs, :tot_gp,
                        :opening_cash, :cash_sales, :cash_exp, :bills_alloc,
                        :expected_cash, :actual_cash, :cash_disc,
                        :notes, :items, :finalized_at
                    ) ON DUPLICATE KEY UPDATE
                        status = VALUES(status),
                        total_prepared = VALUES(total_prepared),
                        total_sold = VALUES(total_sold),
                        total_unsold = VALUES(total_unsold),
                        total_spoilage = VALUES(total_spoilage),
                        total_spoilage_loss = VALUES(total_spoilage_loss),
                        total_revenue = VALUES(total_revenue),
                        total_cogs = VALUES(total_cogs),
                        total_gross_profit = VALUES(total_gross_profit),
                        opening_cash = VALUES(opening_cash),
                        cash_sales = VALUES(cash_sales),
                        cash_expenses = VALUES(cash_expenses),
                        bills_allocation = VALUES(bills_allocation),
                        expected_cash_on_hand = VALUES(expected_cash_on_hand),
                        actual_cash_on_hand = VALUES(actual_cash_on_hand),
                        cash_discrepancy = VALUES(cash_discrepancy),
                        notes = VALUES(notes),
                        items_data = VALUES(items_data),
                        finalized_at = VALUES(finalized_at)";

                    $stmt = $pdo->prepare($sql);
                    $stmt->execute([
                        ':id' => $id,
                        ':date' => $date,
                        ':status' => $status,
                        ':tot_prep' => $totalPrepared,
                        ':tot_sold' => $totalSold,
                        ':tot_unsold' => $totalUnsold,
                        ':tot_spoil' => $totalSpoilage,
                        ':tot_spoil_loss' => $totalSpoilageLoss,
                        ':tot_rev' => $totalRevenue,
                        ':tot_cogs' => $totalCogs,
                        ':tot_gp' => $totalGrossProfit,
                        ':opening_cash' => $openingCash,
                        ':cash_sales' => $cashSales,
                        ':cash_exp' => $cashExpenses,
                        ':bills_alloc' => $billsAllocation,
                        ':expected_cash' => $expectedCash,
                        ':actual_cash' => $actualCash,
                        ':cash_disc' => $cashDiscrepancy,
                        ':notes' => $notes,
                        ':items' => $items,
                        ':finalized_at' => $finalizedAt,
                    ]);

                    $results['processed'][] = [
                        'uuid' => $uuid,
                        'serverId' => 0,
                        'entity' => $entity,
                        'action' => $action,
                    ];
                }
            } elseif ($entity === 'reorder') {
                $orderData = $payload;
                $orderDate = $orderData['order_date'] ?? null;
                if ($orderDate) {
                    $id = $orderData['id'] ?? "reorder-{$orderDate}";
                    $basedOn = $orderData['based_on_date'] ?? null;
                    $status = in_array($orderData['status'] ?? '', ['DRAFT', 'ORDERED', 'RECEIVED']) ? $orderData['status'] : 'DRAFT';
                    $totalQty = (int)($orderData['total_quantity'] ?? 0);
                    $totalCost = (float)($orderData['total_cost'] ?? 0.0);
                    $supplier = $orderData['supplier_name'] ?? 'BBQ Supplier';
                    $notes = $orderData['notes'] ?? null;
                    $receivedAt = !empty($orderData['received_at']) ? date('Y-m-d H:i:s', strtotime($orderData['received_at'])) : null;
                    $itemsJson = json_encode($orderData['items'] ?? []);

                    $sql = 'INSERT INTO reorders (
                        id, order_date, based_on_date, status, total_quantity, total_cost,
                        supplier_name, notes, items_data, received_at, updated_at
                    ) VALUES (
                        :id, :order_date, :based_on_date, :status, :total_quantity, :total_cost,
                        :supplier_name, :notes, :items_data, :received_at, NOW()
                    ) ON DUPLICATE KEY UPDATE
                        based_on_date = VALUES(based_on_date),
                        status = VALUES(status),
                        total_quantity = VALUES(total_quantity),
                        total_cost = VALUES(total_cost),
                        supplier_name = VALUES(supplier_name),
                        notes = VALUES(notes),
                        items_data = VALUES(items_data),
                        received_at = VALUES(received_at),
                        updated_at = NOW()';

                    $stmt = $pdo->prepare($sql);
                    $stmt->execute([
                        ':id' => $id,
                        ':order_date' => $orderDate,
                        ':based_on_date' => $basedOn,
                        ':status' => $status,
                        ':total_quantity' => $totalQty,
                        ':total_cost' => $totalCost,
                        ':supplier_name' => $supplier,
                        ':notes' => $notes,
                        ':items_data' => $itemsJson,
                        ':received_at' => $receivedAt,
                    ]);

                    $results['processed'][] = [
                        'uuid' => $uuid,
                        'serverId' => 0,
                        'entity' => $entity,
                        'action' => $action,
                    ];
                }
            }
        } catch (Throwable $e) {
            $results['failed'][] = [
                'uuid' => $uuid,
                'entity' => $entity,
                'action' => $action,
                'error' => $e->getMessage(),
            ];
        }
    }

    jsonResponse([
        'processed_count' => count($results['processed']),
        'failed_count' => count($results['failed']),
        'processed' => $results['processed'],
        'failed' => $results['failed'],
        'server_time' => date('c'),
    ]);
}
