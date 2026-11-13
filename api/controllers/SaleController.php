<?php
/**
 * Sale Controller
 * Handles sales history queries (sales are created via SyncController)
 */

function handleSales(string $method, ?string $id, ?string $action = null): void {
    $pdo = getDBConnection();

    if ($method === 'DELETE' || ($method === 'POST' && $action === 'void')) {
        if (!$id) {
            jsonError('Sale ID is required for voiding', 400);
            return;
        }
        voidSale($pdo, $id);
        return;
    }

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

    // Optionally include line items
    if (getQueryParam('with_items') && !empty($sales)) {
        $saleIds = array_column($sales, 'id');
        $placeholders = implode(',', array_fill(0, count($saleIds), '?'));
        $stmtItems = $pdo->prepare("SELECT si.* FROM sale_items si WHERE si.sale_id IN ($placeholders) ORDER BY si.id ASC");
        $stmtItems->execute($saleIds);
        $items = $stmtItems->fetchAll();

        $itemsBySale = [];
        foreach ($items as $item) {
            $item['id'] = (int) $item['id'];
            $item['sale_id'] = (int) $item['sale_id'];
            $item['product_id'] = (int) $item['product_id'];
            $item['unit_price'] = (float) $item['unit_price'];
            $item['unit_cost'] = (float) $item['unit_cost'];
            $item['quantity'] = (int) $item['quantity'];
            $item['line_total'] = (float) $item['line_total'];
            $itemsBySale[$item['sale_id']][] = $item;
        }

        foreach ($sales as &$s) {
            $s['items'] = $itemsBySale[$s['id']] ?? [];
        }
        unset($s);
    }

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

function voidSale(PDO $pdo, string $idOrUuid): void {
    try {
        $pdo->beginTransaction();

        // 1. Fetch the sale
        if (is_numeric($idOrUuid)) {
            $stmt = $pdo->prepare('SELECT s.*, pm.name as payment_method_name FROM sales s LEFT JOIN payment_methods pm ON s.payment_method_id = pm.id WHERE s.id = :id FOR UPDATE');
            $stmt->execute([':id' => (int) $idOrUuid]);
        } else {
            $stmt = $pdo->prepare('SELECT s.*, pm.name as payment_method_name FROM sales s LEFT JOIN payment_methods pm ON s.payment_method_id = pm.id WHERE s.uuid = :uuid OR s.receipt_number = :receipt FOR UPDATE');
            $stmt->execute([':uuid' => $idOrUuid, ':receipt' => $idOrUuid]);
        }
        $sale = $stmt->fetch();

        if (!$sale) {
            $pdo->rollBack();
            jsonNotFound('Sale record not found');
            return;
        }

        $saleId = (int) $sale['id'];
        $receiptNumber = $sale['receipt_number'];
        $customerId = $sale['customer_id'] ? (int) $sale['customer_id'] : null;
        $totalAmount = (float) $sale['total_amount'];
        $cashTendered = isset($sale['cash_tendered']) ? (float) $sale['cash_tendered'] : 0;
        $pMethodName = $sale['payment_method_name'] ?: '';
        $isUtang = stripos($pMethodName, 'utang') !== false || stripos($pMethodName, 'credit') !== false;

        // 2. Fetch sale items to restore inventory
        $stmtItems = $pdo->prepare('SELECT * FROM sale_items WHERE sale_id = :sale_id');
        $stmtItems->execute([':sale_id' => $saleId]);
        $items = $stmtItems->fetchAll();

        foreach ($items as $item) {
            $productId = (int) $item['product_id'];
            $qty = (float) $item['quantity'];

            // Fetch current product stock
            $stmtProd = $pdo->prepare('SELECT current_stock FROM products WHERE id = :id FOR UPDATE');
            $stmtProd->execute([':id' => $productId]);
            $prod = $stmtProd->fetch();

            if ($prod) {
                $stockBefore = (float) $prod['current_stock'];
                $stockAfter = $stockBefore + $qty;

                // Update product stock
                $stmtUpProd = $pdo->prepare('UPDATE products SET current_stock = :stock WHERE id = :id');
                $stmtUpProd->execute([':stock' => $stockAfter, ':id' => $productId]);

                // Record inventory movement
                $stmtMov = $pdo->prepare('
                    INSERT INTO inventory_movements (product_id, type, quantity_change, stock_before, stock_after, reference_type, reference_id, notes)
                    VALUES (:pid, :type, :change, :before, :after, :reftype, :refid, :notes)
                ');
                $stmtMov->execute([
                    ':pid' => $productId,
                    ':type' => 'RESTOCK',
                    ':change' => $qty,
                    ':before' => $stockBefore,
                    ':after' => $stockAfter,
                    ':reftype' => 'void_sale',
                    ':refid' => $saleId,
                    ':notes' => "Void Resibo #{$receiptNumber}",
                ]);
            }
        }

        // 3. If Utang sale, reverse customer balance & write ledger entry
        if ($customerId && $isUtang) {
            $cashDown = $cashTendered > 0 ? min($totalAmount, $cashTendered) : 0;
            $reversalAmt = max(0, $totalAmount - $cashDown);

            if ($reversalAmt > 0) {
                $stmtCust = $pdo->prepare('SELECT current_balance FROM customers WHERE id = :id FOR UPDATE');
                $stmtCust->execute([':id' => $customerId]);
                $cBal = (float) $stmtCust->fetchColumn();
                $newBal = max(0, $cBal - $reversalAmt);

                $stmtUpCust = $pdo->prepare('UPDATE customers SET current_balance = :bal, updated_at = NOW() WHERE id = :id');
                $stmtUpCust->execute([':bal' => $newBal, ':id' => $customerId]);

                $stmtLedger = $pdo->prepare('
                    INSERT INTO customer_ledger (uuid, customer_id, transaction_type, amount, balance_after, reference_type, reference_id, payment_method, notes, created_at)
                    VALUES (UUID(), :cid, :type, :amt, :after, :reftype, :refid, :pmethod, :notes, NOW())
                ');
                $stmtLedger->execute([
                    ':cid' => $customerId,
                    ':type' => 'PAYMENT',
                    ':amt' => $reversalAmt,
                    ':after' => $newBal,
                    ':reftype' => 'VOID',
                    ':refid' => $receiptNumber,
                    ':pmethod' => 'Void / Cancel',
                    ':notes' => "Kanselado / Void Resibo #{$receiptNumber}",
                ]);
            }
        }

        // 4. Delete the sale from sales table (cascade deletes sale_items)
        $stmtDel = $pdo->prepare('DELETE FROM sales WHERE id = :id');
        $stmtDel->execute([':id' => $saleId]);

        $pdo->commit();

        jsonResponse([
            'success' => true,
            'message' => "Matagumpay na na-VOID ang Resibo #{$receiptNumber}. Naibalik ang stocks.",
            'receipt_number' => $receiptNumber,
            'sale_id' => $saleId,
        ]);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('Void Sale Error: ' . $e->getMessage());
        jsonError('Hindi ma-void ang resibo: ' . $e->getMessage(), 500);
    }
}
