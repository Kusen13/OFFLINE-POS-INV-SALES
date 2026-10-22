<?php
/**
 * Supplier Controller
 * Manages vendor/supplier catalog
 */

function handleSuppliers(string $method, ?string $id): void {
    $pdo = getDBConnection();

    switch ($method) {
        case 'GET':
            if ($id) {
                getSupplierById($pdo, $id);
            } else {
                listSuppliers($pdo);
            }
            break;
        case 'POST':
            createSupplier($pdo);
            break;
        case 'PUT':
            if (!$id) jsonError('Supplier ID required', 400);
            updateSupplierRecord($pdo, $id);
            break;
        case 'DELETE':
            if (!$id) jsonError('Supplier ID required', 400);
            deleteSupplierRecord($pdo, $id);
            break;
        default:
            jsonMethodNotAllowed();
    }
}

function listSuppliers(PDO $pdo): void {
    $stmt = $pdo->query('SELECT * FROM suppliers WHERE is_active = 1 ORDER BY name ASC');
    $suppliers = $stmt->fetchAll();
    $formatted = array_map(function ($s) {
        $s['is_active'] = (bool) $s['is_active'];
        return $s;
    }, $suppliers);
    jsonResponse($formatted);
}

function getSupplierById(PDO $pdo, string $id): void {
    $stmt = $pdo->prepare('SELECT * FROM suppliers WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $s = $stmt->fetch();
    if (!$s) {
        jsonNotFound('Supplier not found');
    }
    $s['is_active'] = (bool) $s['is_active'];
    jsonResponse($s);
}

function createSupplier(PDO $pdo): void {
    $data = getJsonBody();
    if (empty($data['name'])) {
        jsonError('Supplier name is required', 400);
    }

    $id = $data['id'] ?? ('sup-' . bin2hex(random_bytes(6)));
    $name = sanitizeString($data['name']);
    $contact = sanitizeString($data['contact_person'] ?? null);
    $phone = sanitizeString($data['phone'] ?? null);
    $address = sanitizeString($data['address'] ?? null);
    $email = sanitizeString($data['email'] ?? null);
    $notes = sanitizeString($data['notes'] ?? null);
    $isActive = isset($data['is_active']) ? (int)$data['is_active'] : 1;

    $stmt = $pdo->prepare(
        'INSERT INTO suppliers (id, name, contact_person, phone, address, email, notes, is_active, created_at, updated_at) 
         VALUES (:id, :name, :contact, :phone, :address, :email, :notes, :is_active, NOW(), NOW())
         ON DUPLICATE KEY UPDATE 
            contact_person = VALUES(contact_person),
            phone = VALUES(phone),
            address = VALUES(address),
            email = VALUES(email),
            notes = VALUES(notes),
            is_active = VALUES(is_active),
            updated_at = NOW()'
    );

    $stmt->execute([
        ':id' => $id,
        ':name' => $name,
        ':contact' => $contact,
        ':phone' => $phone,
        ':address' => $address,
        ':email' => $email,
        ':notes' => $notes,
        ':is_active' => $isActive,
    ]);

    getSupplierById($pdo, $id);
}

function updateSupplierRecord(PDO $pdo, string $id): void {
    $data = getJsonBody();
    $stmt = $pdo->prepare('SELECT * FROM suppliers WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $existing = $stmt->fetch();
    if (!$existing) {
        jsonNotFound('Supplier not found');
    }

    $name = sanitizeString($data['name'] ?? $existing['name']);
    $contact = sanitizeString($data['contact_person'] ?? $existing['contact_person']);
    $phone = sanitizeString($data['phone'] ?? $existing['phone']);
    $address = sanitizeString($data['address'] ?? $existing['address']);
    $email = sanitizeString($data['email'] ?? $existing['email']);
    $notes = sanitizeString($data['notes'] ?? $existing['notes']);
    $isActive = isset($data['is_active']) ? (int)$data['is_active'] : (int)$existing['is_active'];

    $stmt = $pdo->prepare(
        'UPDATE suppliers SET 
            name = :name, contact_person = :contact, phone = :phone, 
            address = :address, email = :email, notes = :notes, is_active = :is_active, 
            updated_at = NOW() 
         WHERE id = :id'
    );
    $stmt->execute([
        ':name' => $name,
        ':contact' => $contact,
        ':phone' => $phone,
        ':address' => $address,
        ':email' => $email,
        ':notes' => $notes,
        ':is_active' => $isActive,
        ':id' => $id,
    ]);

    getSupplierById($pdo, $id);
}

function deleteSupplierRecord(PDO $pdo, string $id): void {
    $stmt = $pdo->prepare('UPDATE suppliers SET is_active = 0, updated_at = NOW() WHERE id = :id');
    $stmt->execute([':id' => $id]);
    jsonResponse(['message' => 'Supplier removed successfully']);
}
