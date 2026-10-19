<?php
/**
 * Inventory Controller
 * Handles stock level queries and manual stock movements
 */

function handleInventory(string $method, ?string $id, ?string $action): void {
    $pdo = getDBConnection();

    if ($action === 'movements') {
        if ($method === 'GET') {
            listMovements($pdo);
        } elseif ($method === 'POST') {
            createMovement($pdo);
        } else {
            jsonMethodNotAllowed();
        }
        return;
    }

    if ($method === 'GET') {
        if ($id) {
            getProductStock($pdo, (int) $id);
        } else {
            listInventory($pdo);
        }
    } else {
        jsonMethodNotAllowed();
    }
}

function listInventory(PDO $pdo): void {
    $pagination = getPagination();
    $categoryId = sanitizeInt(getQueryParam('category_id'));
    $lowStockOnly = getQueryParam('low_stock_only', '0');
    $search = sanitizeString(getQueryParam('search'));

    $where = ['p.is_active = 1'];
    $params = [];

    if ($lowStockOnly === '1') {
        $where[] = 'p.current_stock <= p.low_stock_threshold';
    }

    if ($categoryId !== null) {
        $where[] = 'p.category_id = :category_id';
        $params[':category_id'] = $categoryId;
    }

    if ($search) {
        $where[] = '(p.name LIKE :search OR p.sku LIKE :search_sku)';
        $params[':search'] = "%$search%";
        $params[':search_sku'] = "%$search%";
    }

    $whereClause = 'WHERE ' . implode(' AND ', $where);

    $countSql = "SELECT COUNT(*) FROM products p $whereClause";
    $stmt = $pdo->prepare($countSql);
    $stmt->execute($params);
    $total = (int) $stmt->fetchColumn();

    $sql = "SELECT p.id, p.name, p.sku, p.current_stock, p.low_stock_threshold, 
                   p.cost_price, p.selling_price, p.category_id, c.name as category_name,
                   CASE WHEN p.current_stock <= p.low_stock_threshold THEN 1 ELSE 0 END as is_low_stock
            FROM products p 
            LEFT JOIN categories c ON p.category_id = c.id 
            $whereClause 
            ORDER BY is_low_stock DESC, p.name ASC 
            LIMIT :limit OFFSET :offset";

    $stmt = $pdo->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value);
    }
    $stmt->bindValue(':limit', $pagination['per_page'], PDO::PARAM_INT);
    $stmt->bindValue(':offset', $pagination['offset'], PDO::PARAM_INT);
    $stmt->execute();
    $inventory = $stmt->fetchAll();

    $inventory = array_map(function ($item) {
        $item['id'] = (int) $item['id'];
        $item['category_id'] = (int) $item['category_id'];
        $item['current_stock'] = (int) $item['current_stock'];
        $item['low_stock_threshold'] = (int) $item['low_stock_threshold'];
        $item['cost_price'] = (float) $item['cost_price'];
        $item['selling_price'] = (float) $item['selling_price'];
        $item['is_low_stock'] = (bool) $item['is_low_stock'];
        return $item;
    }, $inventory);

    jsonPaginatedResponse($inventory, $total, $pagination['page'], $pagination['per_page']);
}

function getProductStock(PDO $pdo, int $productId): void {
    $stmt = $pdo->prepare(
        'SELECT p.*, c.name as category_name FROM products p 
         LEFT JOIN categories c ON p.category_id = c.id 
         WHERE p.id = :id'
    );
    $stmt->execute([':id' => $productId]);
    $product = $stmt->fetch();

    if (!$product) {
        jsonNotFound('Product not found');
    }

    // Get recent movements
    $stmt = $pdo->prepare(
        'SELECT * FROM inventory_movements WHERE product_id = :id ORDER BY created_at DESC LIMIT 20'
    );
    $stmt->execute([':id' => $productId]);
    $movements = $stmt->fetchAll();

    $product['movements'] = array_map(function ($m) {
        $m['id'] = (int) $m['id'];
        $m['product_id'] = (int) $m['product_id'];
        $m['quantity_change'] = (int) $m['quantity_change'];
        $m['stock_before'] = (int) $m['stock_before'];
        $m['stock_after'] = (int) $m['stock_after'];
        $m['reference_id'] = $m['reference_id'] ? (int) $m['reference_id'] : null;
        return $m;
    }, $movements);

    jsonResponse($product);
}

function listMovements(PDO $pdo): void {
    $pagination = getPagination();
    $productId = sanitizeInt(getQueryParam('product_id'));
    $type = sanitizeString(getQueryParam('type'));
    $dateFrom = getQueryParam('date_from');
    $dateTo = getQueryParam('date_to');

    $where = [];
    $params = [];

    if ($productId !== null) {
        $where[] = 'im.product_id = :product_id';
        $params[':product_id'] = $productId;
    }

    if ($type) {
        $where[] = 'im.type = :type';
        $params[':type'] = $type;
    }

    if ($dateFrom) {
        $where[] = 'im.created_at >= :date_from';
        $params[':date_from'] = $dateFrom . ' 00:00:00';
    }

    if ($dateTo) {
        $where[] = 'im.created_at <= :date_to';
        $params[':date_to'] = $dateTo . ' 23:59:59';
    }

    $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $countSql = "SELECT COUNT(*) FROM inventory_movements im $whereClause";
    $stmt = $pdo->prepare($countSql);
    $stmt->execute($params);
    $total = (int) $stmt->fetchColumn();

    $sql = "SELECT im.*, p.name as product_name, p.sku as product_sku
            FROM inventory_movements im
            LEFT JOIN products p ON im.product_id = p.id
            $whereClause
            ORDER BY im.created_at DESC
            LIMIT :limit OFFSET :offset";

    $stmt = $pdo->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value);
    }
    $stmt->bindValue(':limit', $pagination['per_page'], PDO::PARAM_INT);
    $stmt->bindValue(':offset', $pagination['offset'], PDO::PARAM_INT);
    $stmt->execute();
    $movements = $stmt->fetchAll();

    jsonPaginatedResponse($movements, $total, $pagination['page'], $pagination['per_page']);
}

function createMovement(PDO $pdo): void {
    $data = getJsonBody();
    $errors = validateRequired($data, ['product_id', 'type', 'quantity_change']);
    if ($errors) {
        jsonError('Validation failed', 422, $errors);
    }

    $validTypes = ['STOCK_IN', 'ADJUSTMENT', 'RETURN'];
    if (!in_array($data['type'], $validTypes, true)) {
        jsonError('Invalid movement type. Use: ' . implode(', ', $validTypes), 400);
    }

    $productId = sanitizeInt($data['product_id']);
    $quantityChange = sanitizeInt($data['quantity_change']);

    if ($quantityChange === 0 || $quantityChange === null) {
        jsonError('Quantity change cannot be zero', 400);
    }

    $pdo->beginTransaction();

    try {
        // Lock product row
        $stmt = $pdo->prepare('SELECT current_stock FROM products WHERE id = :id FOR UPDATE');
        $stmt->execute([':id' => $productId]);
        $product = $stmt->fetch();

        if (!$product) {
            $pdo->rollBack();
            jsonNotFound('Product not found');
        }

        $stockBefore = (int) $product['current_stock'];
        $stockAfter = $stockBefore + $quantityChange;

        // Update product stock
        $stmt = $pdo->prepare('UPDATE products SET current_stock = :stock WHERE id = :id');
        $stmt->execute([':stock' => $stockAfter, ':id' => $productId]);

        // Record movement
        $stmt = $pdo->prepare(
            'INSERT INTO inventory_movements (product_id, type, quantity_change, stock_before, stock_after, reference_type, reference_id, notes) 
             VALUES (:product_id, :type, :qty, :before, :after, :ref_type, :ref_id, :notes)'
        );

        $stmt->execute([
            ':product_id' => $productId,
            ':type' => $data['type'],
            ':qty' => $quantityChange,
            ':before' => $stockBefore,
            ':after' => $stockAfter,
            ':ref_type' => sanitizeString($data['reference_type'] ?? 'manual'),
            ':ref_id' => sanitizeInt($data['reference_id'] ?? null),
            ':notes' => sanitizeString($data['notes'] ?? null),
        ]);

        $pdo->commit();

        jsonResponse([
            'movement_id' => (int) $pdo->lastInsertId(),
            'product_id' => $productId,
            'stock_before' => $stockBefore,
            'stock_after' => $stockAfter,
            'quantity_change' => $quantityChange,
        ], 201);

    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}
