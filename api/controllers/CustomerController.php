<?php
/**
 * Customer & Suki Utang Controller
 * Handles customer CRUD, credit balance tracking, ledger history, and debt payments
 */

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../utils/response.php';
require_once __DIR__ . '/../utils/uuid.php';
require_once __DIR__ . '/../middleware/validation.php';

function handleCustomers(string $method, ?string $id, ?string $action): void {
    $pdo = getDBConnection();

    switch ($method) {
        case 'GET':
            if ($id === null) {
                getAllCustomers($pdo);
            } elseif ($action === 'ledger') {
                getCustomerLedger($pdo, (int)$id);
            } else {
                getCustomerById($pdo, (int)$id);
            }
            break;

        case 'POST':
            if ($id !== null && ($action === 'payment' || $action === 'pay')) {
                recordCustomerPayment($pdo, (int)$id);
            } elseif ($id === null) {
                createCustomer($pdo);
            } else {
                jsonMethodNotAllowed();
            }
            break;

        case 'PUT':
        case 'PATCH':
            if ($id !== null) {
                updateCustomer($pdo, (int)$id);
            } else {
                jsonMethodNotAllowed();
            }
            break;

        case 'DELETE':
            if ($id !== null) {
                deleteCustomer($pdo, (int)$id);
            } else {
                jsonMethodNotAllowed();
            }
            break;

        default:
            jsonMethodNotAllowed();
    }
}

/**
 * List all active customers with total utang summary
 */
function getAllCustomers(PDO $pdo): void {
    $q = getQueryParam('q');
    $filter = getQueryParam('filter'); // 'all', 'debtors', 'settled'

    $sql = 'SELECT * FROM customers WHERE is_active = 1';
    $params = [];

    if (!empty($q)) {
        $sql .= ' AND (name LIKE :q OR phone LIKE :q OR address LIKE :q)';
        $params[':q'] = "%$q%";
    }

    if ($filter === 'debtors') {
        $sql .= ' AND current_balance > 0';
    } elseif ($filter === 'settled') {
        $sql .= ' AND current_balance <= 0';
    }

    $sql .= ' ORDER BY current_balance DESC, name ASC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $customers = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Calculate overall stats
    $statsStmt = $pdo->query('
        SELECT 
            COALESCE(SUM(CASE WHEN current_balance > 0 THEN current_balance ELSE 0 END), 0) AS total_receivables,
            COUNT(CASE WHEN current_balance > 0 THEN 1 END) AS debtor_count,
            COUNT(*) AS total_customers
        FROM customers 
        WHERE is_active = 1
    ');
    $stats = $statsStmt->fetch(PDO::FETCH_ASSOC);

    // Today's collected debt payments
    $todayStmt = $pdo->query("
        SELECT COALESCE(SUM(amount), 0) AS collected_today
        FROM customer_ledger
        WHERE transaction_type = 'PAYMENT' AND DATE(created_at) = CURDATE()
    ");
    $collectedToday = (float) $todayStmt->fetchColumn();

    // Specific date collection query if provided
    $targetDate = getQueryParam('date');
    $collectedForDate = $collectedToday;
    if (!empty($targetDate) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $targetDate)) {
        $dateStmt = $pdo->prepare("
            SELECT COALESCE(SUM(amount), 0) AS collected
            FROM customer_ledger
            WHERE transaction_type = 'PAYMENT' AND DATE(created_at) = :dt
        ");
        $dateStmt->execute([':dt' => $targetDate]);
        $collectedForDate = (float) $dateStmt->fetchColumn();
    }

    $customers = array_map(function ($c) {
        $c['id'] = (int) $c['id'];
        $c['credit_limit'] = (float) $c['credit_limit'];
        $c['current_balance'] = (float) $c['current_balance'];
        $c['is_active'] = (bool) $c['is_active'];
        return $c;
    }, $customers);

    jsonResponse([
        'customers' => $customers,
        'summary' => [
            'total_receivables' => (float) $stats['total_receivables'],
            'debtor_count' => (int) $stats['debtor_count'],
            'total_customers' => (int) $stats['total_customers'],
            'collected_today' => $collectedToday,
            'collected_for_date' => $collectedForDate,
        ],
    ]);
}

/**
 * Get single customer with their transaction history
 */
function getCustomerById(PDO $pdo, int $id): void {
    $stmt = $pdo->prepare('SELECT * FROM customers WHERE id = :id AND is_active = 1');
    $stmt->execute([':id' => $id]);
    $customer = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$customer) {
        jsonNotFound('Customer hindi natagpuan');
    }

    $customer['id'] = (int) $customer['id'];
    $customer['credit_limit'] = (float) $customer['credit_limit'];
    $customer['current_balance'] = (float) $customer['current_balance'];
    $customer['is_active'] = (bool) $customer['is_active'];

    // Fetch ledger entries
    $ledgerStmt = $pdo->prepare('
        SELECT * FROM customer_ledger 
        WHERE customer_id = :id 
        ORDER BY created_at DESC, id DESC 
        LIMIT 100
    ');
    $ledgerStmt->execute([':id' => $id]);
    $ledger = $ledgerStmt->fetchAll(PDO::FETCH_ASSOC);

    $customer['ledger'] = array_map(function ($row) {
        $row['id'] = (int) $row['id'];
        $row['customer_id'] = (int) $row['customer_id'];
        $row['amount'] = (float) $row['amount'];
        $row['balance_after'] = (float) $row['balance_after'];
        return $row;
    }, $ledger);

    jsonResponse(['customer' => $customer]);
}

/**
 * Create a new suki customer
 */
function createCustomer(PDO $pdo): void {
    $data = getJsonBody();
    $name = trim($data['name'] ?? '');

    if (empty($name)) {
        jsonError('Kailangan ilagay ang pangalan ng Suki', 400);
    }

    $uuid = generateUUID();
    $phone = sanitizeString($data['phone'] ?? null);
    $address = sanitizeString($data['address'] ?? null);
    $creditLimit = sanitizeDecimal($data['credit_limit'] ?? 0);
    $initialBalance = sanitizeDecimal($data['initial_balance'] ?? 0);
    $notes = sanitizeString($data['notes'] ?? null);

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('
            INSERT INTO customers (uuid, name, phone, address, credit_limit, current_balance, notes, is_active, created_at, updated_at)
            VALUES (:uuid, :name, :phone, :address, :credit_limit, :current_balance, :notes, 1, NOW(), NOW())
        ');
        $stmt->execute([
            ':uuid' => $uuid,
            ':name' => $name,
            ':phone' => $phone,
            ':address' => $address,
            ':credit_limit' => $creditLimit,
            ':current_balance' => $initialBalance,
            ':notes' => $notes,
        ]);

        $customerId = (int) $pdo->lastInsertId();

        if ($initialBalance > 0) {
            $ledgerStmt = $pdo->prepare('
                INSERT INTO customer_ledger (uuid, customer_id, transaction_type, amount, balance_after, reference_type, reference_id, payment_method, notes, created_at)
                VALUES (UUID(), :cid, :type, :amt, :after, :reftype, :refid, :pmethod, :notes, NOW())
            ');
            $ledgerStmt->execute([
                ':cid' => $customerId,
                ':type' => 'CHARGE',
                ':amt' => $initialBalance,
                ':after' => $initialBalance,
                ':reftype' => 'INITIAL_BALANCE',
                ':refid' => 'INIT-' . str_pad((string)$customerId, 4, '0', STR_PAD_LEFT),
                ':pmethod' => 'Credit',
                ':notes' => 'Panimulang balanse ng utang',
            ]);
        }

        $pdo->commit();

        jsonResponse([
            'id' => $customerId,
            'uuid' => $uuid,
            'name' => $name,
            'phone' => $phone,
            'address' => $address,
            'credit_limit' => $creditLimit,
            'current_balance' => $initialBalance,
            'notes' => $notes,
            'message' => 'Matagumpay na nairehistro ang bagong Suki',
        ], 201);
    } catch (Throwable $e) {
        $pdo->rollBack();
        jsonError('Hindi nairehistro ang Suki: ' . $e->getMessage(), 500);
    }
}

/**
 * Update suki customer details
 */
function updateCustomer(PDO $pdo, int $id): void {
    $data = getJsonBody();
    $name = trim($data['name'] ?? '');

    if (empty($name)) {
        jsonError('Kailangan ilagay ang pangalan ng Suki', 400);
    }

    $phone = sanitizeString($data['phone'] ?? null);
    $address = sanitizeString($data['address'] ?? null);
    $creditLimit = sanitizeDecimal($data['credit_limit'] ?? 0);
    $notes = sanitizeString($data['notes'] ?? null);

    $stmt = $pdo->prepare('
        UPDATE customers 
        SET name = :name, phone = :phone, address = :address, credit_limit = :credit_limit, notes = :notes, updated_at = NOW()
        WHERE id = :id AND is_active = 1
    ');
    $stmt->execute([
        ':id' => $id,
        ':name' => $name,
        ':phone' => $phone,
        ':address' => $address,
        ':credit_limit' => $creditLimit,
        ':notes' => $notes,
    ]);

    jsonResponse(['message' => 'Na-update ang impormasyon ng Suki']);
}

/**
 * Record a payment against an existing debt (Magbayad ng Utang)
 */
function recordCustomerPayment(PDO $pdo, int $id): void {
    $data = getJsonBody();
    $amount = (float) ($data['amount'] ?? 0);
    $paymentMethod = sanitizeString($data['payment_method'] ?? 'Cash');
    $notes = sanitizeString($data['notes'] ?? 'Bayad sa Utang');

    if ($amount <= 0) {
        jsonError('Kailangan may halaga ang ibabayad (greater than 0)', 400);
    }

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT id, name, current_balance FROM customers WHERE id = :id AND is_active = 1 FOR UPDATE');
        $stmt->execute([':id' => $id]);
        $customer = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$customer) {
            $pdo->rollBack();
            jsonNotFound('Customer hindi natagpuan');
        }

        $currentBal = (float) $customer['current_balance'];
        $newBal = max(0, $currentBal - $amount); // Can be 0 or allow credit advance if needed

        // Update balance
        $upStmt = $pdo->prepare('UPDATE customers SET current_balance = :bal, updated_at = NOW() WHERE id = :id');
        $upStmt->execute([':bal' => $newBal, ':id' => $id]);

        // Receipt number for this payment
        $payReceipt = 'PAY-' . date('Ymd') . '-' . strtoupper(substr(uniqid(), -4));

        // Insert ledger record
        $ledgerStmt = $pdo->prepare('
            INSERT INTO customer_ledger (uuid, customer_id, transaction_type, amount, balance_after, reference_type, reference_id, payment_method, notes, created_at)
            VALUES (UUID(), :cid, :type, :amt, :after, :reftype, :refid, :pmethod, :notes, NOW())
        ');
        $ledgerStmt->execute([
            ':cid' => $id,
            ':type' => 'PAYMENT',
            ':amt' => $amount,
            ':after' => $newBal,
            ':reftype' => 'DEBT_PAYMENT',
            ':refid' => $payReceipt,
            ':pmethod' => $paymentMethod,
            ':notes' => $notes,
        ]);

        $pdo->commit();

        jsonResponse([
            'success' => true,
            'message' => 'Matagumpay na naitala ang bayad!',
            'payment' => [
                'receipt_number' => $payReceipt,
                'customer_id' => $id,
                'customer_name' => $customer['name'],
                'amount_paid' => $amount,
                'previous_balance' => $currentBal,
                'remaining_balance' => $newBal,
                'payment_method' => $paymentMethod,
                'notes' => $notes,
                'paid_at' => date('c'),
            ]
        ]);
    } catch (Throwable $e) {
        $pdo->rollBack();
        jsonError('Hindi naitala ang bayad: ' . $e->getMessage(), 500);
    }
}

/**
 * Soft delete customer
 */
function deleteCustomer(PDO $pdo, int $id): void {
    $stmt = $pdo->prepare('UPDATE customers SET is_active = 0, updated_at = NOW() WHERE id = :id');
    $stmt->execute([':id' => $id]);
    jsonResponse(['message' => 'Na-delete ang customer']);
}
