<?php
/**
 * Category Controller
 * Handles CRUD operations for categories
 */

function handleCategories(string $method, ?string $id): void {
    $pdo = getDBConnection();

    switch ($method) {
        case 'GET':
            if ($id) {
                getCategory($pdo, (int) $id);
            } else {
                listCategories($pdo);
            }
            break;
        case 'POST':
            createCategory($pdo);
            break;
        case 'PUT':
            if (!$id) jsonError('Category ID required', 400);
            updateCategory($pdo, (int) $id);
            break;
        case 'DELETE':
            if (!$id) jsonError('Category ID required', 400);
            deactivateCategory($pdo, (int) $id);
            break;
        default:
            jsonMethodNotAllowed();
    }
}

function listCategories(PDO $pdo): void {
    $activeOnly = getQueryParam('active_only', '1');
    $withCounts = getQueryParam('with_counts', '0');

    $where = $activeOnly === '1' ? 'WHERE c.is_active = 1' : '';

    if ($withCounts === '1') {
        $sql = "SELECT c.*, COUNT(p.id) as product_count 
                FROM categories c 
                LEFT JOIN products p ON p.category_id = c.id AND p.is_active = 1 
                $where 
                GROUP BY c.id 
                ORDER BY c.sort_order ASC, c.name ASC";
    } else {
        $sql = "SELECT c.* FROM categories c $where ORDER BY c.sort_order ASC, c.name ASC";
    }

    $stmt = $pdo->query($sql);
    $categories = $stmt->fetchAll();

    $categories = array_map(function ($c) {
        $c['id'] = (int) $c['id'];
        $c['sort_order'] = (int) $c['sort_order'];
        $c['is_active'] = (bool) $c['is_active'];
        if (isset($c['product_count'])) {
            $c['product_count'] = (int) $c['product_count'];
        }
        return $c;
    }, $categories);

    jsonResponse($categories);
}

function getCategory(PDO $pdo, int $id): void {
    $stmt = $pdo->prepare('SELECT * FROM categories WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $category = $stmt->fetch();

    if (!$category) {
        jsonNotFound('Category not found');
    }

    $category['id'] = (int) $category['id'];
    $category['sort_order'] = (int) $category['sort_order'];
    $category['is_active'] = (bool) $category['is_active'];

    jsonResponse($category);
}

function createCategory(PDO $pdo): void {
    $data = getJsonBody();
    $errors = validateRequired($data, ['name']);
    if ($errors) {
        jsonError('Validation failed', 422, $errors);
    }

    // Check duplicate name
    $stmt = $pdo->prepare('SELECT id FROM categories WHERE name = :name');
    $stmt->execute([':name' => $data['name']]);
    if ($stmt->fetch()) {
        jsonError('Category name already exists', 409);
    }

    $stmt = $pdo->prepare(
        'INSERT INTO categories (name, description, sort_order, is_active) 
         VALUES (:name, :description, :sort_order, :active)'
    );

    $stmt->execute([
        ':name' => sanitizeString($data['name']),
        ':description' => sanitizeString($data['description'] ?? null),
        ':sort_order' => sanitizeInt($data['sort_order'] ?? 0),
        ':active' => isset($data['is_active']) ? (int) $data['is_active'] : 1,
    ]);

    $id = (int) $pdo->lastInsertId();
    getCategory($pdo, $id);
}

function updateCategory(PDO $pdo, int $id): void {
    $data = getJsonBody();

    $stmt = $pdo->prepare('SELECT * FROM categories WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $existing = $stmt->fetch();
    if (!$existing) {
        jsonNotFound('Category not found');
    }

    // Check duplicate name if changed
    if (isset($data['name']) && $data['name'] !== $existing['name']) {
        $stmt = $pdo->prepare('SELECT id FROM categories WHERE name = :name AND id != :id');
        $stmt->execute([':name' => $data['name'], ':id' => $id]);
        if ($stmt->fetch()) {
            jsonError('Category name already exists', 409);
        }
    }

    $stmt = $pdo->prepare(
        'UPDATE categories SET name = :name, description = :description, sort_order = :sort_order, is_active = :active WHERE id = :id'
    );

    $stmt->execute([
        ':name' => sanitizeString($data['name'] ?? $existing['name']),
        ':description' => sanitizeString($data['description'] ?? $existing['description']),
        ':sort_order' => sanitizeInt($data['sort_order'] ?? $existing['sort_order']),
        ':active' => isset($data['is_active']) ? (int) $data['is_active'] : (int) $existing['is_active'],
        ':id' => $id,
    ]);

    getCategory($pdo, $id);
}

function deactivateCategory(PDO $pdo, int $id): void {
    $stmt = $pdo->prepare('SELECT id FROM categories WHERE id = :id');
    $stmt->execute([':id' => $id]);
    if (!$stmt->fetch()) {
        jsonNotFound('Category not found');
    }

    $stmt = $pdo->prepare('UPDATE categories SET is_active = 0 WHERE id = :id');
    $stmt->execute([':id' => $id]);

    jsonResponse(['message' => 'Category deactivated']);
}
