<?php
/**
 * Payment Method Controller
 */

function handlePaymentMethods(string $method, ?string $id): void {
    $pdo = getDBConnection();

    switch ($method) {
        case 'GET':
            listPaymentMethods($pdo);
            break;
        case 'POST':
            createPaymentMethod($pdo);
            break;
        case 'PUT':
            if (!$id) jsonError('Payment method ID required', 400);
            updatePaymentMethod($pdo, (int) $id);
            break;
        default:
            jsonMethodNotAllowed();
    }
}

function listPaymentMethods(PDO $pdo): void {
    $stmt = $pdo->query('SELECT * FROM payment_methods ORDER BY sort_order ASC, name ASC');
    $methods = $stmt->fetchAll();
    $methods = array_map(function ($m) {
        $m['id'] = (int) $m['id'];
        $m['is_active'] = (bool) $m['is_active'];
        $m['sort_order'] = (int) $m['sort_order'];
        return $m;
    }, $methods);
    jsonResponse($methods);
}

function createPaymentMethod(PDO $pdo): void {
    $data = getJsonBody();
    $errors = validateRequired($data, ['name']);
    if ($errors) jsonError('Validation failed', 422, $errors);

    $stmt = $pdo->prepare('SELECT id FROM payment_methods WHERE name = :name');
    $stmt->execute([':name' => $data['name']]);
    if ($stmt->fetch()) jsonError('Payment method already exists', 409);

    $stmt = $pdo->prepare(
        'INSERT INTO payment_methods (name, is_active, sort_order) VALUES (:name, :active, :sort)'
    );
    $stmt->execute([
        ':name' => sanitizeString($data['name']),
        ':active' => isset($data['is_active']) ? (int) $data['is_active'] : 1,
        ':sort' => sanitizeInt($data['sort_order'] ?? 0),
    ]);

    $id = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare('SELECT * FROM payment_methods WHERE id = :id');
    $stmt->execute([':id' => $id]);
    jsonResponse($stmt->fetch(), 201);
}

function updatePaymentMethod(PDO $pdo, int $id): void {
    $data = getJsonBody();
    $stmt = $pdo->prepare('SELECT * FROM payment_methods WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $existing = $stmt->fetch();
    if (!$existing) jsonNotFound('Payment method not found');

    $stmt = $pdo->prepare(
        'UPDATE payment_methods SET name = :name, is_active = :active, sort_order = :sort WHERE id = :id'
    );
    $stmt->execute([
        ':name' => sanitizeString($data['name'] ?? $existing['name']),
        ':active' => isset($data['is_active']) ? (int) $data['is_active'] : (int) $existing['is_active'],
        ':sort' => sanitizeInt($data['sort_order'] ?? $existing['sort_order']),
        ':id' => $id,
    ]);

    $stmt = $pdo->prepare('SELECT * FROM payment_methods WHERE id = :id');
    $stmt->execute([':id' => $id]);
    jsonResponse($stmt->fetch());
}
