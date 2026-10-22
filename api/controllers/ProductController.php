<?php
/**
 * Product Controller
 * Handles CRUD operations for products
 */

function handleProducts(string $method, ?string $id, ?string $action): void {
    $pdo = getDBConnection();

    // GET /api/products - List all products
    // GET /api/products/{id} - Get single product
    // POST /api/products - Create product
    // PUT /api/products/{id} - Update product
    // GET /api/products/low-stock - Get low stock products
    
    if ($method === 'GET' && $id === 'low-stock') {
        getLowStockProducts($pdo);
        return;
    }

    switch ($method) {
        case 'GET':
            if ($id) {
                getProduct($pdo, (int) $id);
            } else {
                listProducts($pdo);
            }
            break;
        case 'POST':
            createProduct($pdo);
            break;
        case 'PUT':
            if (!$id) jsonError('Product ID required', 400);
            updateProduct($pdo, (int) $id);
            break;
        case 'DELETE':
            if (!$id) jsonError('Product ID required', 400);
            deactivateProduct($pdo, (int) $id);
            break;
        default:
            jsonMethodNotAllowed();
    }
}

function listProducts(PDO $pdo): void {
    $pagination = getPagination();
    $categoryId = sanitizeInt(getQueryParam('category_id'));
    $search = sanitizeString(getQueryParam('search'));
    $activeOnly = getQueryParam('active_only', '1');
    $since = getQueryParam('since'); // ISO timestamp for sync

    $where = [];
    $params = [];

    if ($activeOnly === '1') {
        $where[] = 'p.is_active = 1';
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

    if ($since) {
        $where[] = 'p.updated_at > :since';
        $params[':since'] = $since;
    }

    $itemType = sanitizeString(getQueryParam('item_type'));
    if ($itemType === 'product' || $itemType === 'supply') {
        $where[] = 'p.item_type = :item_type';
        $params[':item_type'] = $itemType;
    }

    $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    // Count total
    $countSql = "SELECT COUNT(*) FROM products p $whereClause";
    $stmt = $pdo->prepare($countSql);
    $stmt->execute($params);
    $total = (int) $stmt->fetchColumn();

    // Fetch page
    $sql = "SELECT p.*, c.name as category_name 
            FROM products p 
            LEFT JOIN categories c ON p.category_id = c.id 
            $whereClause 
            ORDER BY p.name ASC 
            LIMIT :limit OFFSET :offset";

    $stmt = $pdo->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value);
    }
    $stmt->bindValue(':limit', $pagination['per_page'], PDO::PARAM_INT);
    $stmt->bindValue(':offset', $pagination['offset'], PDO::PARAM_INT);
    $stmt->execute();
    $products = $stmt->fetchAll();

    // Cast numeric and custom master fields
    $products = array_map(function ($p) {
        $p['id'] = (int) $p['id'];
        $p['category_id'] = (int) $p['category_id'];
        $p['item_type'] = $p['item_type'] ?? 'product';
        $p['cost_price'] = (float) $p['cost_price'];
        $p['selling_price'] = (float) $p['selling_price'];
        $p['current_stock'] = (int) $p['current_stock'];
        $p['initial_stock'] = isset($p['initial_stock']) ? (int) $p['initial_stock'] : (int) $p['current_stock'];
        $p['initial_stock_date'] = $p['initial_stock_date'] ?? null;
        $p['low_stock_threshold'] = (int) $p['low_stock_threshold'];
        $p['target_stock'] = isset($p['target_stock']) ? (int) $p['target_stock'] : 20;
        $p['unit'] = $p['unit'] ?? 'sticks';
        $p['supplier_id'] = $p['supplier_id'] ?? null;
        $p['supplier_name'] = $p['supplier_name'] ?? null;
        $p['reseller_price'] = isset($p['reseller_price']) && $p['reseller_price'] !== null ? (float) $p['reseller_price'] : null;
        $p['is_active'] = (bool) $p['is_active'];
        return $p;
    }, $products);

    jsonPaginatedResponse($products, $total, $pagination['page'], $pagination['per_page']);
}

function getProduct(PDO $pdo, int $id): void {
    $stmt = $pdo->prepare(
        'SELECT p.*, c.name as category_name 
         FROM products p 
         LEFT JOIN categories c ON p.category_id = c.id 
         WHERE p.id = :id'
    );
    $stmt->execute([':id' => $id]);
    $product = $stmt->fetch();

    if (!$product) {
        jsonNotFound('Product not found');
    }

    $product['id'] = (int) $product['id'];
    $product['category_id'] = (int) $product['category_id'];
    $product['item_type'] = $product['item_type'] ?? 'product';
    $product['cost_price'] = (float) $product['cost_price'];
    $product['selling_price'] = (float) $product['selling_price'];
    $product['current_stock'] = (int) $product['current_stock'];
    $product['initial_stock'] = isset($product['initial_stock']) ? (int) $product['initial_stock'] : (int) $product['current_stock'];
    $product['initial_stock_date'] = $product['initial_stock_date'] ?? null;
    $product['low_stock_threshold'] = (int) $product['low_stock_threshold'];
    $product['target_stock'] = isset($product['target_stock']) ? (int) $product['target_stock'] : 20;
    $product['unit'] = $product['unit'] ?? 'sticks';
    $product['supplier_id'] = $product['supplier_id'] ?? null;
    $product['supplier_name'] = $product['supplier_name'] ?? null;
    $product['reseller_price'] = isset($product['reseller_price']) && $product['reseller_price'] !== null ? (float) $product['reseller_price'] : null;
    $product['is_active'] = (bool) $product['is_active'];

    jsonResponse($product);
}

function createProduct(PDO $pdo): void {
    $data = getJsonBody();
    $itemType = in_array($data['item_type'] ?? '', ['product', 'supply']) ? $data['item_type'] : 'product';

    // selling_price is only required for 'product' type
    $requiredFields = ['name', 'sku', 'category_id'];
    if ($itemType === 'product') {
        $requiredFields[] = 'selling_price';
    }
    $errors = validateRequired($data, $requiredFields);
    if ($errors) {
        jsonError('Validation failed', 422, $errors);
    }

    // Check duplicate SKU
    $stmt = $pdo->prepare('SELECT id FROM products WHERE sku = :sku');
    $stmt->execute([':sku' => $data['sku']]);
    if ($stmt->fetch()) {
        jsonError('SKU already exists', 409);
    }

    $stockVal = isset($data['initial_stock']) ? sanitizeInt($data['initial_stock']) : sanitizeInt($data['current_stock'] ?? 0);
    $initialStockDate = !empty($data['initial_stock_date']) ? $data['initial_stock_date'] : '2026-10-19';
    if ($initialStockDate < '2026-10-19') {
        $initialStockDate = '2026-10-19';
    }
    // Supplies are never for sale
    $sellingPrice = $itemType === 'supply' ? 0 : sanitizeDecimal($data['selling_price'] ?? 0);

    $stmt = $pdo->prepare(
        'INSERT INTO products (
            category_id, name, sku, description, item_type, cost_price, selling_price, current_stock, initial_stock, 
            initial_stock_date, low_stock_threshold, target_stock, unit, supplier_id, supplier_name, reseller_price, image_path, is_active
        ) VALUES (
            :category_id, :name, :sku, :description, :item_type, :cost_price, :selling_price, :stock, :initial_stock, 
            :initial_stock_date, :threshold, :target_stock, :unit, :supplier_id, :supplier_name, :reseller_price, :image, :active
        )'
    );

    $stmt->execute([
        ':category_id' => sanitizeInt($data['category_id']),
        ':name' => sanitizeString($data['name']),
        ':sku' => sanitizeString($data['sku']),
        ':description' => sanitizeString($data['description'] ?? null),
        ':item_type' => $itemType,
        ':cost_price' => sanitizeDecimal($data['cost_price'] ?? 0),
        ':selling_price' => $sellingPrice,
        ':stock' => $stockVal,
        ':initial_stock' => $stockVal,
        ':initial_stock_date' => $initialStockDate,
        ':threshold' => sanitizeInt($data['low_stock_threshold'] ?? 10),
        ':target_stock' => sanitizeInt($data['target_stock'] ?? 20),
        ':unit' => sanitizeString($data['unit'] ?? 'sticks'),
        ':supplier_id' => sanitizeString($data['supplier_id'] ?? null),
        ':supplier_name' => sanitizeString($data['supplier_name'] ?? null),
        ':reseller_price' => isset($data['reseller_price']) && $data['reseller_price'] !== '' ? sanitizeDecimal($data['reseller_price']) : null,
        ':image' => sanitizeString($data['image_path'] ?? null),
        ':active' => isset($data['is_active']) ? (int) $data['is_active'] : 1,
    ]);

    $productId = (int) $pdo->lastInsertId();

    // Create initial inventory movement if stock > 0
    if ($stockVal > 0) {
        $stmt = $pdo->prepare(
            'INSERT INTO inventory_movements (product_id, type, quantity_change, stock_before, stock_after, reference_type, notes) 
             VALUES (:product_id, :type, :qty, 0, :after, :ref_type, :notes)'
        );
        $stmt->execute([
            ':product_id' => $productId,
            ':type' => 'INITIAL',
            ':qty' => $stockVal,
            ':after' => $stockVal,
            ':ref_type' => 'manual',
            ':notes' => 'Initial stock on product creation (Date: ' . $initialStockDate . ')',
        ]);
    }

    getProduct($pdo, $productId);
}

function updateProduct(PDO $pdo, int $id): void {
    $data = getJsonBody();

    // Check product exists
    $stmt = $pdo->prepare('SELECT * FROM products WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $existing = $stmt->fetch();
    if (!$existing) {
        jsonNotFound('Product not found');
    }

    // Check duplicate SKU if changed
    if (isset($data['sku']) && $data['sku'] !== $existing['sku']) {
        $stmt = $pdo->prepare('SELECT id FROM products WHERE sku = :sku AND id != :id');
        $stmt->execute([':sku' => $data['sku'], ':id' => $id]);
        if ($stmt->fetch()) {
            jsonError('SKU already exists', 409);
        }
    }

    $currentStock = isset($data['current_stock']) ? sanitizeInt($data['current_stock']) : (int) $existing['current_stock'];
    $initialStock = isset($data['initial_stock']) ? sanitizeInt($data['initial_stock']) : (isset($data['current_stock']) ? sanitizeInt($data['current_stock']) : (int) ($existing['initial_stock'] ?? $currentStock));
    $initialStockDate = !empty($data['initial_stock_date']) ? $data['initial_stock_date'] : ($existing['initial_stock_date'] ?? '2026-10-19');
    if ($initialStockDate < '2026-10-19') {
        $initialStockDate = '2026-10-19';
    }
    $itemType = in_array($data['item_type'] ?? '', ['product', 'supply']) ? $data['item_type'] : ($existing['item_type'] ?? 'product');
    $sellingPrice = $itemType === 'supply' ? 0 : sanitizeDecimal($data['selling_price'] ?? $existing['selling_price']);

    $stmt = $pdo->prepare(
        'UPDATE products SET 
            category_id = :category_id,
            name = :name,
            sku = :sku,
            description = :description,
            item_type = :item_type,
            cost_price = :cost_price,
            selling_price = :selling_price,
            current_stock = :current_stock,
            initial_stock = :initial_stock,
            initial_stock_date = :initial_stock_date,
            low_stock_threshold = :threshold,
            target_stock = :target_stock,
            unit = :unit,
            supplier_id = :supplier_id,
            supplier_name = :supplier_name,
            reseller_price = :reseller_price,
            image_path = :image,
            is_active = :active,
            updated_at = NOW()
         WHERE id = :id'
    );

    $stmt->execute([
        ':category_id' => sanitizeInt($data['category_id'] ?? $existing['category_id']),
        ':name' => sanitizeString($data['name'] ?? $existing['name']),
        ':sku' => sanitizeString($data['sku'] ?? $existing['sku']),
        ':description' => sanitizeString($data['description'] ?? $existing['description']),
        ':item_type' => $itemType,
        ':cost_price' => sanitizeDecimal($data['cost_price'] ?? $existing['cost_price']),
        ':selling_price' => $sellingPrice,
        ':current_stock' => $currentStock,
        ':initial_stock' => $initialStock,
        ':initial_stock_date' => $initialStockDate,
        ':threshold' => sanitizeInt($data['low_stock_threshold'] ?? $existing['low_stock_threshold']),
        ':target_stock' => sanitizeInt($data['target_stock'] ?? ($existing['target_stock'] ?? 20)),
        ':unit' => sanitizeString($data['unit'] ?? ($existing['unit'] ?? 'sticks')),
        ':supplier_id' => sanitizeString($data['supplier_id'] ?? $existing['supplier_id']),
        ':supplier_name' => sanitizeString($data['supplier_name'] ?? $existing['supplier_name']),
        ':reseller_price' => isset($data['reseller_price']) && $data['reseller_price'] !== '' ? sanitizeDecimal($data['reseller_price']) : (isset($existing['reseller_price']) ? $existing['reseller_price'] : null),
        ':image' => sanitizeString($data['image_path'] ?? $existing['image_path']),
        ':active' => isset($data['is_active']) ? (int) $data['is_active'] : (int) $existing['is_active'],
        ':id' => $id,
    ]);

    getProduct($pdo, $id);
}

function deactivateProduct(PDO $pdo, int $id): void {
    $stmt = $pdo->prepare('SELECT id FROM products WHERE id = :id');
    $stmt->execute([':id' => $id]);
    if (!$stmt->fetch()) {
        jsonNotFound('Product not found');
    }

    // Soft delete
    $stmt = $pdo->prepare('UPDATE products SET is_active = 0 WHERE id = :id');
    $stmt->execute([':id' => $id]);

    jsonResponse(['message' => 'Product deactivated']);
}

function getLowStockProducts(PDO $pdo): void {
    $stmt = $pdo->prepare(
        'SELECT p.*, c.name as category_name 
         FROM products p 
         LEFT JOIN categories c ON p.category_id = c.id 
         WHERE p.is_active = 1 AND p.current_stock <= p.low_stock_threshold 
         ORDER BY (CAST(p.current_stock AS SIGNED) - CAST(p.low_stock_threshold AS SIGNED)) ASC, p.name ASC'
    );
    $stmt->execute();
    $products = $stmt->fetchAll();

    $products = array_map(function ($p) {
        $p['id'] = (int) $p['id'];
        $p['category_id'] = (int) $p['category_id'];
        $p['item_type'] = $p['item_type'] ?? 'product';
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

    jsonResponse($products);
}
