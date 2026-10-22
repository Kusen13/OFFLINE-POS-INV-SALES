<?php
/**
 * Bill Controller
 * Manages monthly recurring bills and daily obligations
 */

function handleBills(string $method, ?string $id): void {
    $pdo = getDBConnection();

    switch ($method) {
        case 'GET':
            if ($id) {
                getBillById($pdo, $id);
            } else {
                $month = getQueryParam('month');
                listBills($pdo, $month);
            }
            break;
        case 'POST':
            saveBillRecord($pdo);
            break;
        case 'PUT':
            saveBillRecord($pdo);
            break;
        case 'DELETE':
            if (!$id) jsonError('Bill ID required', 400);
            deleteBillRecord($pdo, $id);
            break;
        default:
            jsonMethodNotAllowed();
    }
}

function listBills(PDO $pdo, ?string $month): void {
    if ($month) {
        $stmt = $pdo->prepare('SELECT * FROM bills WHERE month = :month ORDER BY name ASC');
        $stmt->execute([':month' => $month]);
    } else {
        $stmt = $pdo->query('SELECT * FROM bills ORDER BY month DESC, name ASC');
    }
    $records = $stmt->fetchAll();
    $formatted = array_map(function ($b) {
        $b['daily_obligation'] = (float)$b['daily_obligation'];
        $b['total_target_amount'] = (float)$b['total_target_amount'];
        $b['daily_allocations'] = !empty($b['daily_allocations']) ? json_decode($b['daily_allocations'], true) : [];
        return $b;
    }, $records);
    jsonResponse($formatted);
}

function getBillById(PDO $pdo, string $id): void {
    $stmt = $pdo->prepare('SELECT * FROM bills WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $b = $stmt->fetch();
    if (!$b) {
        jsonNotFound('Bill not found');
    }
    $b['daily_obligation'] = (float)$b['daily_obligation'];
    $b['total_target_amount'] = (float)$b['total_target_amount'];
    $b['daily_allocations'] = !empty($b['daily_allocations']) ? json_decode($b['daily_allocations'], true) : [];
    jsonResponse($b);
}

function saveBillRecord(PDO $pdo): void {
    $data = getJsonBody();
    if (empty($data['name']) || empty($data['month'])) {
        jsonError('Bill name and month are required', 400);
    }

    $id = $data['id'] ?? ('bill-' . bin2hex(random_bytes(6)));
    $name = sanitizeString($data['name']);
    $daily = sanitizeDecimal($data['daily_obligation'] ?? 0);
    $total = sanitizeDecimal($data['total_target_amount'] ?? 0);
    $month = sanitizeString($data['month']);
    $dueDate = sanitizeString($data['due_date'] ?? null);
    $notes = sanitizeString($data['notes'] ?? null);
    $allocJson = isset($data['daily_allocations']) ? json_encode($data['daily_allocations']) : '[]';

    $stmt = $pdo->prepare(
        'INSERT INTO bills (id, name, daily_obligation, total_target_amount, month, due_date, notes, daily_allocations, created_at, updated_at) 
         VALUES (:id, :name, :daily, :total, :month, :due, :notes, :alloc, NOW(), NOW())
         ON DUPLICATE KEY UPDATE 
            name = VALUES(name),
            daily_obligation = VALUES(daily_obligation),
            total_target_amount = VALUES(total_target_amount),
            due_date = VALUES(due_date),
            notes = VALUES(notes),
            daily_allocations = VALUES(daily_allocations),
            updated_at = NOW()'
    );

    $stmt->execute([
        ':id' => $id,
        ':name' => $name,
        ':daily' => $daily,
        ':total' => $total,
        ':month' => $month,
        ':due' => $dueDate,
        ':notes' => $notes,
        ':alloc' => $allocJson,
    ]);

    getBillById($pdo, $id);
}

function deleteBillRecord(PDO $pdo, string $id): void {
    $stmt = $pdo->prepare('DELETE FROM bills WHERE id = :id');
    $stmt->execute([':id' => $id]);
    jsonResponse(['message' => 'Bill deleted successfully']);
}
