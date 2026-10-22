<?php
/**
 * Daily Closing Controller
 * Manages daily shifts, stock reconciliation, and cash drawer balancing
 */

function handleDailyClosings(string $method, ?string $id): void {
    $pdo = getDBConnection();

    switch ($method) {
        case 'GET':
            if ($id) {
                getDailyClosingById($pdo, $id);
            } else {
                $date = getQueryParam('date');
                if ($date) {
                    getDailyClosingByDate($pdo, $date);
                } else {
                    listDailyClosings($pdo);
                }
            }
            break;
        case 'POST':
        case 'PUT':
            saveDailyClosingRecord($pdo);
            break;
        case 'DELETE':
            if (!$id) jsonError('Closing ID or Date required', 400);
            deleteDailyClosingRecord($pdo, $id);
            break;
        default:
            jsonMethodNotAllowed();
    }
}

function getDailyClosingByDate(PDO $pdo, string $date): void {
    $stmt = $pdo->prepare('SELECT * FROM daily_closings WHERE date = :date');
    $stmt->execute([':date' => $date]);
    $closing = $stmt->fetch();
    if (!$closing) {
        jsonNotFound("No closing record found for date: $date");
    }
    jsonResponse(formatClosingRecord($closing));
}

function getDailyClosingById(PDO $pdo, string $id): void {
    $stmt = $pdo->prepare('SELECT * FROM daily_closings WHERE id = :id OR date = :date');
    $stmt->execute([':id' => $id, ':date' => $id]);
    $closing = $stmt->fetch();
    if (!$closing) {
        jsonNotFound("Closing not found");
    }
    jsonResponse(formatClosingRecord($closing));
}

function listDailyClosings(PDO $pdo): void {
    $stmt = $pdo->query('SELECT * FROM daily_closings ORDER BY date DESC LIMIT 60');
    $records = $stmt->fetchAll();
    $formatted = array_map('formatClosingRecord', $records);
    jsonResponse($formatted);
}

function saveDailyClosingRecord(PDO $pdo): void {
    $data = getJsonBody();
    if (empty($data['date'])) {
        jsonError('Date is required', 422);
    }

    $id = !empty($data['id']) ? $data['id'] : 'closing-' . $data['date'];
    $date = $data['date'];
    $status = !empty($data['status']) && in_array($data['status'], ['DRAFT', 'FINALIZED']) ? $data['status'] : 'DRAFT';
    $items = isset($data['items']) ? (is_string($data['items']) ? $data['items'] : json_encode($data['items'])) : '[]';

    $totalPrepared = (int) ($data['total_prepared'] ?? 0);
    $totalSold = (int) ($data['total_sold'] ?? 0);
    $totalUnsold = (int) ($data['total_unsold'] ?? 0);
    $totalSpoilage = (int) ($data['total_spoilage'] ?? 0);
    $totalSpoilageLoss = (float) ($data['total_spoilage_loss'] ?? 0);
    $totalRevenue = (float) ($data['total_revenue'] ?? 0);
    $totalCogs = (float) ($data['total_cogs'] ?? 0);
    $totalGrossProfit = (float) ($data['total_gross_profit'] ?? 0);

    $openingCash = (float) ($data['opening_cash'] ?? 0);
    $cashSales = (float) ($data['cash_sales'] ?? 0);
    $cashExpenses = (float) ($data['cash_expenses'] ?? 0);
    $billsAllocation = (float) ($data['bills_allocation'] ?? 0);
    $expectedCash = (float) ($data['expected_cash_on_hand'] ?? 0);
    $actualCash = (float) ($data['actual_cash_on_hand'] ?? 0);
    $cashDiscrepancy = (float) ($data['cash_discrepancy'] ?? 0);
    $notes = isset($data['notes']) ? sanitizeString($data['notes']) : null;
    $finalizedAt = !empty($data['finalized_at']) ? $data['finalized_at'] : ($status === 'FINALIZED' ? date('Y-m-d H:i:s') : null);

    $sql = "INSERT INTO daily_closings (
        id, date, status, total_prepared, total_sold, total_unsold, total_spoilage,
        total_spoilage_loss, total_revenue, total_cogs, total_gross_profit,
        opening_cash, cash_sales, cash_expenses, bills_allocation,
        expected_cash_on_hand, actual_cash_on_hand, cash_discrepancy,
        notes, items_data, finalized_at
    ) VALUES (
        :id, :date, :status, :tot_prep, :tot_sold, :tot_unsold, :tot_spoil,
        :tot_spoil_loss, :tot_rev, :tot_cogs, :tot_gp,
        :opening_cash, :cash_sales, :cash_exp, :bills_alloc,
        :expected_cash, :actual_cash, :cash_disc,
        :notes, :items, :finalized_at
    ) ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        total_prepared = VALUES(total_prepared),
        total_sold = VALUES(total_sold),
        total_unsold = VALUES(total_unsold),
        total_spoilage = VALUES(total_spoilage),
        total_spoilage_loss = VALUES(total_spoilage_loss),
        total_revenue = VALUES(total_revenue),
        total_cogs = VALUES(total_cogs),
        total_gross_profit = VALUES(total_gross_profit),
        opening_cash = VALUES(opening_cash),
        cash_sales = VALUES(cash_sales),
        cash_expenses = VALUES(cash_expenses),
        bills_allocation = VALUES(bills_allocation),
        expected_cash_on_hand = VALUES(expected_cash_on_hand),
        actual_cash_on_hand = VALUES(actual_cash_on_hand),
        cash_discrepancy = VALUES(cash_discrepancy),
        notes = VALUES(notes),
        items_data = VALUES(items_data),
        finalized_at = VALUES(finalized_at)";

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        ':id' => $id,
        ':date' => $date,
        ':status' => $status,
        ':tot_prep' => $totalPrepared,
        ':tot_sold' => $totalSold,
        ':tot_unsold' => $totalUnsold,
        ':tot_spoil' => $totalSpoilage,
        ':tot_spoil_loss' => $totalSpoilageLoss,
        ':tot_rev' => $totalRevenue,
        ':tot_cogs' => $totalCogs,
        ':tot_gp' => $totalGrossProfit,
        ':opening_cash' => $openingCash,
        ':cash_sales' => $cashSales,
        ':cash_exp' => $cashExpenses,
        ':bills_alloc' => $billsAllocation,
        ':expected_cash' => $expectedCash,
        ':actual_cash' => $actualCash,
        ':cash_disc' => $cashDiscrepancy,
        ':notes' => $notes,
        ':items' => $items,
        ':finalized_at' => $finalizedAt,
    ]);

    // Synchronize products current_stock to unsold_qty from Daily Closing
    $parsedItems = is_array($data['items'] ?? null) ? $data['items'] : json_decode($items, true);
    if (!empty($parsedItems) && is_array($parsedItems)) {
        $upStockStmt = $pdo->prepare('UPDATE products SET current_stock = :stock WHERE id = :id');
        foreach ($parsedItems as $it) {
            $pId = (int)($it['product_id'] ?? 0);
            if ($pId > 0 && isset($it['unsold_qty'])) {
                $upStockStmt->execute([
                    ':stock' => max(0, (int)$it['unsold_qty']),
                    ':id' => $pId
                ]);
            }
        }
    }

    getDailyClosingByDate($pdo, $date);
}

function deleteDailyClosingRecord(PDO $pdo, string $id): void {
    $stmt = $pdo->prepare('DELETE FROM daily_closings WHERE id = :id OR date = :date');
    $stmt->execute([':id' => $id, ':date' => $id]);
    jsonResponse(['message' => 'Closing record deleted/re-opened']);
}

function formatClosingRecord(array $row): array {
    $items = [];
    if (!empty($row['items_data'])) {
        $decoded = json_decode($row['items_data'], true);
        if (is_array($decoded)) {
            $items = $decoded;
        }
    }

    return [
        'id' => $row['id'],
        'date' => $row['date'],
        'status' => $row['status'],
        'items' => $items,
        'total_prepared' => (int) $row['total_prepared'],
        'total_sold' => (int) $row['total_sold'],
        'total_unsold' => (int) $row['total_unsold'],
        'total_spoilage' => (int) $row['total_spoilage'],
        'total_spoilage_loss' => (float) $row['total_spoilage_loss'],
        'total_revenue' => (float) $row['total_revenue'],
        'total_cogs' => (float) $row['total_cogs'],
        'total_gross_profit' => (float) $row['total_gross_profit'],
        'opening_cash' => (float) $row['opening_cash'],
        'cash_sales' => (float) $row['cash_sales'],
        'cash_expenses' => (float) $row['cash_expenses'],
        'bills_allocation' => (float) $row['bills_allocation'],
        'expected_cash_on_hand' => (float) $row['expected_cash_on_hand'],
        'actual_cash_on_hand' => (float) $row['actual_cash_on_hand'],
        'cash_discrepancy' => (float) $row['cash_discrepancy'],
        'notes' => $row['notes'],
        'finalized_at' => $row['finalized_at'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
    ];
}
