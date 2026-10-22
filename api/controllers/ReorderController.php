<?php
/**
 * Re-order Controller
 * Manages daily BBQ replenishment orders and historical sheets
 */

function handleReorders(string $method, ?string $id): void {
    $pdo = getDBConnection();

    // Ensure reorders table exists
    ensureReordersTable($pdo);

    switch ($method) {
        case 'GET':
            if ($id) {
                getReorderById($pdo, $id);
            } else {
                $date = getQueryParam('date');
                if ($date) {
                    getReorderByDate($pdo, $date);
                } else {
                    listReorders($pdo);
                }
            }
            break;
        case 'POST':
        case 'PUT':
            saveReorderRecord($pdo);
            break;
        case 'DELETE':
            if (!$id) jsonError('Order Date or ID required', 400);
            deleteReorderRecord($pdo, $id);
            break;
        default:
            jsonMethodNotAllowed();
    }
}

function ensureReordersTable(PDO $pdo): void {
    $sql = "CREATE TABLE IF NOT EXISTS `reorders` (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;";
    try {
        $pdo->exec($sql);
    } catch (Exception $e) {
        // Table may already exist or error logged
    }
}

function getReorderByDate(PDO $pdo, string $date): void {
    $stmt = $pdo->prepare('SELECT * FROM reorders WHERE order_date = :date');
    $stmt->execute([':date' => $date]);
    $rec = $stmt->fetch();
    if (!$rec) {
        jsonNotFound("No reorder sheet found for date: $date");
    }
    jsonResponse(formatReorderRecord($rec));
}

function getReorderById(PDO $pdo, string $id): void {
    $stmt = $pdo->prepare('SELECT * FROM reorders WHERE id = :id OR order_date = :date');
    $stmt->execute([':id' => $id, ':date' => $id]);
    $rec = $stmt->fetch();
    if (!$rec) {
        jsonNotFound("Re-order record not found");
    }
    jsonResponse(formatReorderRecord($rec));
}

function listReorders(PDO $pdo): void {
    $stmt = $pdo->query('SELECT * FROM reorders ORDER BY order_date DESC LIMIT 60');
    $records = $stmt->fetchAll();
    $formatted = array_map('formatReorderRecord', $records);
    jsonResponse($formatted);
}

function saveReorderRecord(PDO $pdo): void {
    $data = getJsonBody();
    if (empty($data['order_date'])) {
        jsonError('Order date is required', 400);
    }

    $orderDate = $data['order_date'];
    $id = $data['id'] ?? "reorder-{$orderDate}";
    $basedOn = $data['based_on_date'] ?? null;
    $status = in_array($data['status'] ?? '', ['DRAFT', 'ORDERED', 'RECEIVED']) ? $data['status'] : 'DRAFT';
    $totalQty = (int)($data['total_quantity'] ?? 0);
    $totalCost = (float)($data['total_cost'] ?? 0.0);
    $supplier = $data['supplier_name'] ?? 'BBQ Supplier';
    $notes = $data['notes'] ?? null;
    $receivedAt = !empty($data['received_at']) ? date('Y-m-d H:i:s', strtotime($data['received_at'])) : null;
    $itemsJson = json_encode($data['items'] ?? []);

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

    jsonResponse([
        'success' => true,
        'message' => 'Re-order sheet saved successfully',
        'id' => $id,
        'order_date' => $orderDate,
    ]);
}

function deleteReorderRecord(PDO $pdo, string $id): void {
    $stmt = $pdo->prepare('DELETE FROM reorders WHERE id = :id OR order_date = :date');
    $stmt->execute([':id' => $id, ':date' => $id]);
    jsonResponse([
        'success' => true,
        'message' => 'Re-order sheet deleted successfully',
    ]);
}

function formatReorderRecord(array $row): array {
    return [
        'id' => $row['id'],
        'order_date' => $row['order_date'],
        'based_on_date' => $row['based_on_date'],
        'status' => $row['status'],
        'total_quantity' => (int)$row['total_quantity'],
        'total_cost' => (float)$row['total_cost'],
        'supplier_name' => $row['supplier_name'],
        'notes' => $row['notes'],
        'items' => json_decode($row['items_data'] ?? '[]', true) ?: [],
        'received_at' => $row['received_at'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
    ];
}
