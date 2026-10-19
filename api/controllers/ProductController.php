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

    // Cast numeric fields
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
    $product['cost_price'] = (float) $product['cost_price'];
    $product['selling_price'] = (float) $product['selling_price'];
    $product['current_stock'] = (int) $product['current_stock'];
    $product['low_stock_threshold'] = (int) $product['low_stock_threshold'];
    $product['is_active'] = (bool) $product['is_active'];

    jsonResponse($product);
}

function createProduct(PDO $pdo): void {
    $data = getJsonBody();
    $errors = validateRequired($data, ['name', 'sku', 'category_id', 'selling_price']);
    if ($errors) {
        jsonError('Validation failed', 422, $errors);
    }

    // Check duplicate SKU
    $stmt = $pdo->prepare('SELECT id FROM products WHERE sku = :sku');
    $stmt->execute([':sku' => $data['sku']]);
    if ($stmt->fetch()) {
        jsonError('SKU already exists', 409);
    }

    $stmt = $pdo->prepare(
        'INSERT INTO products (category_id, name, sku, description, cost_price, selling_price, current_stock, low_stock_threshold, image_path, is_active) 
         VALUES (:category_id, :name, :sku, :description, :cost_price, :selling_price, :stock, :threshold, :image, :active)'
    );

    $stmt->execute([
        ':category_id' => sanitizeInt($data['category_id']),
        ':name' => sanitizeString($data['name']),
        ':sku' => sanitizeString($data['sku']),
        ':description' => sanitizeString($data['description'] ?? null),
        ':cost_price' => sanitizeDecimal($data['cost_price'] ?? 0),
        ':selling_price' => sanitizeDecimal($data['selling_price']),
        ':stock' => sanitizeInt($data['current_stock'] ?? 0),
        ':threshold' => sanitizeInt($data['low_stock_threshold'] ?? 10),
        ':image' => sanitizeString($data['image_path'] ?? null),
        ':active' => isset($data['is_active']) ? (int) $data['is_active'] : 1,
    ]);

    $productId = (int) $pdo->lastInsertId();

    // Create initial inventory movement if stock > 0
    $initialStock = sanitizeInt($data['current_stock'] ?? 0);
    if ($initialStock > 0) {
        $stmt = $pdo->prepare(
            'INSERT INTO inventory_movements (product_id, type, quantity_change, stock_before, stock_after, reference_type, notes) 
             VALUES (:product_id, :type, :qty, 0, :after, :ref_type, :notes)'
        );
        $stmt->execute([
            ':product_id' => $productId,
            ':type' => 'INITIAL',
            ':qty' => $initialStock,
            ':after' => $initialStock,
            ':ref_type' => 'manual',
            ':notes' => 'Initial stock on product creation',
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

    $stmt = $pdo->prepare(
        'UPDATE products SET 
            category_id = :category_id,
            name = :name,
            sku = :sku,
            description = :description,
            cost_price = :cost_price,
            selling_price = :selling_price,
            low_stock_threshold = :threshold,
            image_path = :image,
            is_active = :active
         WHERE id = :id'
    );

    $stmt->execute([
        ':category_id' => sanitizeInt($data['category_id'] ?? $existing['category_id']),
        ':name' => sanitizeString($data['name'] ?? $existing['name']),
        ':sku' => sanitizeString($data['sku'] ?? $existing['sku']),
        ':description' => sanitizeString($data['description'] ?? $existing['description']),
        ':cost_price' => sanitizeDecimal($data['cost_price'] ?? $existing['cost_price']),
        ':selling_price' => sanitizeDecimal($data['selling_price'] ?? $existing['selling_price']),
        ':threshold' => sanitizeInt($data['low_stock_threshold'] ?? $existing['low_stock_threshold']),
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
         ORDER BY (p.current_stock - p.low_stock_threshold) ASC, p.name ASC'
    );
    $stmt->execute();
    $products = $stmt->fetchAll();

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

    jsonResponse($products);
}
