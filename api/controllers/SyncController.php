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

    // Fetch categories
    $catSql = 'SELECT * FROM categories WHERE is_active = 1';
    $catParams = [];
    if ($since) {
        $catSql .= ' AND updated_at > :since';
        $catParams[':since'] = $since;
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
    if ($since) {
        $prodSql .= ' AND p.updated_at > :since';
        $prodParams[':since'] = $since;
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
                            'INSERT INTO products (category_id, name, sku, description, cost_price, selling_price, current_stock, low_stock_threshold, is_active) 
                             VALUES (:cat, :name, :sku, :desc, :cost, :price, :stock, :low, :active)'
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
                        'UPDATE products SET category_id = :cat, name = :name, sku = :sku, description = :desc, 
                                            cost_price = :cost, selling_price = :price, current_stock = :stock, 
                                            low_stock_threshold = :low, is_active = :active 
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
