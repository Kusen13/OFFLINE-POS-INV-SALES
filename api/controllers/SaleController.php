<?php
/**
 * Sale Controller
 * Handles sales history queries (sales are created via SyncController)
 */

function handleSales(string $method, ?string $id): void {
    $pdo = getDBConnection();

    if ($method !== 'GET') {
        jsonMethodNotAllowed();
    }

    if ($id) {
        getSale($pdo, (int) $id);
    } else {
        listSales($pdo);
    }
}

function listSales(PDO $pdo): void {
    $pagination = getPagination();
    $dateFrom = getQueryParam('date_from');
    $dateTo = getQueryParam('date_to');
    $paymentMethodId = sanitizeInt(getQueryParam('payment_method_id'));
    $search = sanitizeString(getQueryParam('search'));

    $where = [];
    $params = [];

    if ($dateFrom) {
        $where[] = 's.sold_at >= :date_from';
        $params[':date_from'] = $dateFrom . ' 00:00:00';
    }

    if ($dateTo) {
        $where[] = 's.sold_at <= :date_to';
        $params[':date_to'] = $dateTo . ' 23:59:59';
    }

    if ($paymentMethodId !== null) {
        $where[] = 's.payment_method_id = :payment_method_id';
        $params[':payment_method_id'] = $paymentMethodId;
    }

    if ($search) {
        $where[] = '(s.receipt_number LIKE :search OR s.uuid LIKE :search_uuid)';
        $params[':search'] = "%$search%";
        $params[':search_uuid'] = "%$search%";
    }

    $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    // Count
    $countSql = "SELECT COUNT(*) FROM sales s $whereClause";
    $stmt = $pdo->prepare($countSql);
    $stmt->execute($params);
    $total = (int) $stmt->fetchColumn();

    // Fetch
    $sql = "SELECT s.*, pm.name as payment_method_name,
                   (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) as item_count
            FROM sales s 
            LEFT JOIN payment_methods pm ON s.payment_method_id = pm.id 
            $whereClause 
            ORDER BY s.sold_at DESC 
            LIMIT :limit OFFSET :offset";

    $stmt = $pdo->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value);
    }
    $stmt->bindValue(':limit', $pagination['per_page'], PDO::PARAM_INT);
    $stmt->bindValue(':offset', $pagination['offset'], PDO::PARAM_INT);
    $stmt->execute();
    $sales = $stmt->fetchAll();

    $sales = array_map(function ($s) {
        $s['id'] = (int) $s['id'];
        $s['subtotal'] = (float) $s['subtotal'];
        $s['discount_amount'] = (float) $s['discount_amount'];
        $s['tax_amount'] = (float) $s['tax_amount'];
        $s['total_amount'] = (float) $s['total_amount'];
        $s['cash_tendered'] = $s['cash_tendered'] !== null ? (float) $s['cash_tendered'] : null;
        $s['change_amount'] = $s['change_amount'] !== null ? (float) $s['change_amount'] : null;
        $s['payment_method_id'] = (int) $s['payment_method_id'];
        $s['item_count'] = (int) $s['item_count'];
        return $s;
    }, $sales);

    jsonPaginatedResponse($sales, $total, $pagination['page'], $pagination['per_page']);
}

function getSale(PDO $pdo, int $id): void {
    $stmt = $pdo->prepare(
        'SELECT s.*, pm.name as payment_method_name 
         FROM sales s 
         LEFT JOIN payment_methods pm ON s.payment_method_id = pm.id 
         WHERE s.id = :id'
    );
    $stmt->execute([':id' => $id]);
    $sale = $stmt->fetch();

    if (!$sale) {
        jsonNotFound('Sale not found');
    }

    // Get line items
    $stmt = $pdo->prepare(
        'SELECT si.*, p.image_path 
         FROM sale_items si 
         LEFT JOIN products p ON si.product_id = p.id 
         WHERE si.sale_id = :sale_id 
         ORDER BY si.id ASC'
    );
    $stmt->execute([':sale_id' => $id]);
    $items = $stmt->fetchAll();

    $sale['id'] = (int) $sale['id'];
    $sale['subtotal'] = (float) $sale['subtotal'];
    $sale['discount_amount'] = (float) $sale['discount_amount'];
    $sale['tax_amount'] = (float) $sale['tax_amount'];
    $sale['total_amount'] = (float) $sale['total_amount'];
    $sale['cash_tendered'] = $sale['cash_tendered'] !== null ? (float) $sale['cash_tendered'] : null;
    $sale['change_amount'] = $sale['change_amount'] !== null ? (float) $sale['change_amount'] : null;
    $sale['payment_method_id'] = (int) $sale['payment_method_id'];

    $sale['items'] = array_map(function ($i) {
        $i['id'] = (int) $i['id'];
        $i['sale_id'] = (int) $i['sale_id'];
        $i['product_id'] = (int) $i['product_id'];
        $i['unit_price'] = (float) $i['unit_price'];
        $i['unit_cost'] = (float) $i['unit_cost'];
        $i['quantity'] = (int) $i['quantity'];
        $i['line_total'] = (float) $i['line_total'];
        return $i;
    }, $items);

    jsonResponse($sale);
}
