<?php
/**
 * Expense Controller
 */

function handleExpenses(string $method, ?string $id): void {
    $pdo = getDBConnection();

    switch ($method) {
        case 'GET':
            if ($id) {
                getExpense($pdo, (int) $id);
            } else {
                listExpenses($pdo);
            }
            break;
        case 'POST':
            createExpense($pdo);
            break;
        case 'PUT':
            if (!$id) jsonError('Expense ID required', 400);
            updateExpense($pdo, (int) $id);
            break;
        case 'DELETE':
            if (!$id) jsonError('Expense ID required', 400);
            deleteExpense($pdo, (int) $id);
            break;
        default:
            jsonMethodNotAllowed();
    }
}

function listExpenses(PDO $pdo): void {
    $pagination = getPagination();
    $category = sanitizeString(getQueryParam('category'));
    $dateFrom = getQueryParam('date_from');
    $dateTo = getQueryParam('date_to');

    $where = [];
    $params = [];

    if ($category) {
        $where[] = 'category = :category';
        $params[':category'] = $category;
    }
    if ($dateFrom) {
        $where[] = 'expense_date >= :date_from';
        $params[':date_from'] = $dateFrom;
    }
    if ($dateTo) {
        $where[] = 'expense_date <= :date_to';
        $params[':date_to'] = $dateTo;
    }

    $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $stmt = $pdo->prepare("SELECT COUNT(*) FROM expenses $whereClause");
    $stmt->execute($params);
    $total = (int) $stmt->fetchColumn();

    $sql = "SELECT * FROM expenses $whereClause ORDER BY expense_date DESC, id DESC LIMIT :limit OFFSET :offset";
    $stmt = $pdo->prepare($sql);
    foreach ($params as $k => $v) $stmt->bindValue($k, $v);
    $stmt->bindValue(':limit', $pagination['per_page'], PDO::PARAM_INT);
    $stmt->bindValue(':offset', $pagination['offset'], PDO::PARAM_INT);
    $stmt->execute();

    jsonPaginatedResponse($stmt->fetchAll(), $total, $pagination['page'], $pagination['per_page']);
}

function getExpense(PDO $pdo, int $id): void {
    $stmt = $pdo->prepare('SELECT * FROM expenses WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $expense = $stmt->fetch();
    if (!$expense) jsonNotFound('Expense not found');
    jsonResponse($expense);
}

function createExpense(PDO $pdo): void {
    $data = getJsonBody();
    $errors = validateRequired($data, ['category', 'description', 'amount', 'expense_date']);
    if ($errors) jsonError('Validation failed', 422, $errors);

    $stmt = $pdo->prepare(
        'INSERT INTO expenses (category, description, amount, expense_date) VALUES (:cat, :desc, :amount, :date)'
    );
    $stmt->execute([
        ':cat' => sanitizeString($data['category']),
        ':desc' => sanitizeString($data['description']),
        ':amount' => sanitizeDecimal($data['amount']),
        ':date' => $data['expense_date'],
    ]);

    getExpense($pdo, (int) $pdo->lastInsertId());
}

function updateExpense(PDO $pdo, int $id): void {
    $data = getJsonBody();
    $stmt = $pdo->prepare('SELECT * FROM expenses WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $existing = $stmt->fetch();
    if (!$existing) jsonNotFound('Expense not found');

    $stmt = $pdo->prepare(
        'UPDATE expenses SET category = :cat, description = :desc, amount = :amount, expense_date = :date WHERE id = :id'
    );
    $stmt->execute([
        ':cat' => sanitizeString($data['category'] ?? $existing['category']),
        ':desc' => sanitizeString($data['description'] ?? $existing['description']),
        ':amount' => sanitizeDecimal($data['amount'] ?? $existing['amount']),
        ':date' => $data['expense_date'] ?? $existing['expense_date'],
        ':id' => $id,
    ]);

    getExpense($pdo, $id);
}

function deleteExpense(PDO $pdo, int $id): void {
    $stmt = $pdo->prepare('SELECT id FROM expenses WHERE id = :id');
    $stmt->execute([':id' => $id]);
    if (!$stmt->fetch()) jsonNotFound('Expense not found');

    $stmt = $pdo->prepare('DELETE FROM expenses WHERE id = :id');
    $stmt->execute([':id' => $id]);
    jsonResponse(['message' => 'Expense deleted']);
}
