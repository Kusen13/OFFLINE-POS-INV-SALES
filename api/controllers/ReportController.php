<?php
/**
 * Report Controller
 * Provides sales summaries, profit reports, and analytics
 */

function handleReports(string $method, ?string $action): void {
    if ($method !== 'GET') {
        jsonMethodNotAllowed();
    }

    $pdo = getDBConnection();

    switch ($action) {
        case 'daily':
            getDailySales($pdo);
            break;
        case 'weekly':
            getWeeklySales($pdo);
            break;
        case 'monthly':
            getMonthlySales($pdo);
            break;
        case 'profit':
            getProfitReport($pdo);
            break;
        case 'summary':
            getDashboardSummary($pdo);
            break;
        case 'top-products':
            getTopProducts($pdo);
            break;
        case 'payment-summary':
            getPaymentSummary($pdo);
            break;
        default:
            jsonNotFound('Unknown report type');
    }
}

function getDailySales(PDO $pdo): void {
    $date = getQueryParam('date', date('Y-m-d'));

    $stmt = $pdo->prepare(
        "SELECT 
            COUNT(*) as total_transactions,
            COALESCE(SUM(total_amount), 0) as total_sales,
            COALESCE(SUM(discount_amount), 0) as total_discounts,
            COALESCE(AVG(total_amount), 0) as avg_transaction
         FROM sales 
         WHERE DATE(sold_at) = :date"
    );
    $stmt->execute([':date' => $date]);
    $summary = $stmt->fetch();

    // Hourly breakdown
    $stmt = $pdo->prepare(
        "SELECT 
            HOUR(sold_at) as hour,
            COUNT(*) as transactions,
            SUM(total_amount) as sales
         FROM sales 
         WHERE DATE(sold_at) = :date
         GROUP BY HOUR(sold_at)
         ORDER BY hour"
    );
    $stmt->execute([':date' => $date]);
    $hourly = $stmt->fetchAll();

    // Gross profit
    $stmt = $pdo->prepare(
        "SELECT 
            COALESCE(SUM(si.line_total), 0) as total_revenue,
            COALESCE(SUM(si.unit_cost * si.quantity), 0) as total_cost
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE DATE(s.sold_at) = :date"
    );
    $stmt->execute([':date' => $date]);
    $profitData = $stmt->fetch();

    $summary['total_transactions'] = (int) $summary['total_transactions'];
    $summary['total_sales'] = (float) $summary['total_sales'];
    $summary['total_discounts'] = (float) $summary['total_discounts'];
    $summary['avg_transaction'] = round((float) $summary['avg_transaction'], 2);
    $summary['gross_profit'] = round((float) $profitData['total_revenue'] - (float) $profitData['total_cost'], 2);
    $summary['total_cost'] = (float) $profitData['total_cost'];
    $summary['date'] = $date;
    $summary['hourly'] = $hourly;

    jsonResponse($summary);
}

function getWeeklySales(PDO $pdo): void {
    $endDate = getQueryParam('end_date', date('Y-m-d'));
    $startDate = date('Y-m-d', strtotime($endDate . ' -6 days'));

    $stmt = $pdo->prepare(
        "SELECT 
            DATE(sold_at) as date,
            COUNT(*) as transactions,
            SUM(total_amount) as sales
         FROM sales 
         WHERE DATE(sold_at) BETWEEN :start AND :end
         GROUP BY DATE(sold_at)
         ORDER BY date"
    );
    $stmt->execute([':start' => $startDate, ':end' => $endDate]);
    $daily = $stmt->fetchAll();

    // Total for period
    $stmt = $pdo->prepare(
        "SELECT 
            COUNT(*) as total_transactions,
            COALESCE(SUM(total_amount), 0) as total_sales
         FROM sales 
         WHERE DATE(sold_at) BETWEEN :start AND :end"
    );
    $stmt->execute([':start' => $startDate, ':end' => $endDate]);
    $totals = $stmt->fetch();

    jsonResponse([
        'start_date' => $startDate,
        'end_date' => $endDate,
        'total_transactions' => (int) $totals['total_transactions'],
        'total_sales' => (float) $totals['total_sales'],
        'daily' => $daily,
    ]);
}

function getMonthlySales(PDO $pdo): void {
    $month = getQueryParam('month', date('Y-m'));

    $stmt = $pdo->prepare(
        "SELECT 
            DATE(sold_at) as date,
            COUNT(*) as transactions,
            SUM(total_amount) as sales
         FROM sales 
         WHERE DATE_FORMAT(sold_at, '%Y-%m') = :month
         GROUP BY DATE(sold_at)
         ORDER BY date"
    );
    $stmt->execute([':month' => $month]);
    $daily = $stmt->fetchAll();

    $stmt = $pdo->prepare(
        "SELECT 
            COUNT(*) as total_transactions,
            COALESCE(SUM(total_amount), 0) as total_sales,
            COALESCE(SUM(discount_amount), 0) as total_discounts
         FROM sales 
         WHERE DATE_FORMAT(sold_at, '%Y-%m') = :month"
    );
    $stmt->execute([':month' => $month]);
    $totals = $stmt->fetch();

    jsonResponse([
        'month' => $month,
        'total_transactions' => (int) $totals['total_transactions'],
        'total_sales' => (float) $totals['total_sales'],
        'total_discounts' => (float) $totals['total_discounts'],
        'daily' => $daily,
    ]);
}

function getProfitReport(PDO $pdo): void {
    $dateFrom = getQueryParam('date_from', date('Y-m-01'));
    $dateTo = getQueryParam('date_to', date('Y-m-d'));

    // Revenue and cost from sales
    $stmt = $pdo->prepare(
        "SELECT 
            COALESCE(SUM(si.line_total), 0) as total_revenue,
            COALESCE(SUM(si.unit_cost * si.quantity), 0) as total_cost,
            COUNT(DISTINCT s.id) as total_transactions
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE DATE(s.sold_at) BETWEEN :from AND :to"
    );
    $stmt->execute([':from' => $dateFrom, ':to' => $dateTo]);
    $salesData = $stmt->fetch();

    // Expenses in the period
    $stmt = $pdo->prepare(
        "SELECT COALESCE(SUM(amount), 0) as total_expenses
         FROM expenses
         WHERE expense_date BETWEEN :from AND :to"
    );
    $stmt->execute([':from' => $dateFrom, ':to' => $dateTo]);
    $expenseData = $stmt->fetch();

    $totalRevenue = (float) $salesData['total_revenue'];
    $totalCost = (float) $salesData['total_cost'];
    $grossProfit = $totalRevenue - $totalCost;
    $totalExpenses = (float) $expenseData['total_expenses'];
    $estimatedNetProfit = $grossProfit - $totalExpenses;

    jsonResponse([
        'date_from' => $dateFrom,
        'date_to' => $dateTo,
        'total_revenue' => round($totalRevenue, 2),
        'total_cost' => round($totalCost, 2),
        'gross_profit' => round($grossProfit, 2),
        'gross_margin' => $totalRevenue > 0 ? round(($grossProfit / $totalRevenue) * 100, 1) : 0,
        'total_expenses' => round($totalExpenses, 2),
        'estimated_net_profit' => round($estimatedNetProfit, 2),
        'total_transactions' => (int) $salesData['total_transactions'],
    ]);
}

function getDashboardSummary(PDO $pdo): void {
    $today = date('Y-m-d');

    // Today's sales
    $stmt = $pdo->prepare(
        "SELECT COUNT(*) as transactions, COALESCE(SUM(total_amount), 0) as sales
         FROM sales WHERE DATE(sold_at) = :today"
    );
    $stmt->execute([':today' => $today]);
    $todaySales = $stmt->fetch();

    // This week
    $weekStart = date('Y-m-d', strtotime('monday this week'));
    $stmt = $pdo->prepare(
        "SELECT COUNT(*) as transactions, COALESCE(SUM(total_amount), 0) as sales
         FROM sales WHERE DATE(sold_at) BETWEEN :start AND :today"
    );
    $stmt->execute([':start' => $weekStart, ':today' => $today]);
    $weekSales = $stmt->fetch();

    // This month
    $monthStart = date('Y-m-01');
    $stmt = $pdo->prepare(
        "SELECT COUNT(*) as transactions, COALESCE(SUM(total_amount), 0) as sales
         FROM sales WHERE DATE(sold_at) BETWEEN :start AND :today"
    );
    $stmt->execute([':start' => $monthStart, ':today' => $today]);
    $monthSales = $stmt->fetch();

    // Low stock count
    $stmt = $pdo->query(
        'SELECT COUNT(*) FROM products WHERE is_active = 1 AND current_stock <= low_stock_threshold'
    );
    $lowStockCount = (int) $stmt->fetchColumn();

    // Total products
    $stmt = $pdo->query('SELECT COUNT(*) FROM products WHERE is_active = 1');
    $totalProducts = (int) $stmt->fetchColumn();

    // Pending sync failures
    $stmt = $pdo->prepare(
        "SELECT COUNT(*) FROM sync_logs WHERE status = 'FAILED' AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)"
    );
    $stmt->execute();
    $pendingFailures = (int) $stmt->fetchColumn();

    jsonResponse([
        'today' => [
            'transactions' => (int) $todaySales['transactions'],
            'sales' => (float) $todaySales['sales'],
        ],
        'this_week' => [
            'transactions' => (int) $weekSales['transactions'],
            'sales' => (float) $weekSales['sales'],
        ],
        'this_month' => [
            'transactions' => (int) $monthSales['transactions'],
            'sales' => (float) $monthSales['sales'],
        ],
        'low_stock_count' => $lowStockCount,
        'total_products' => $totalProducts,
        'pending_sync_failures' => $pendingFailures,
    ]);
}

function getTopProducts(PDO $pdo): void {
    $dateFrom = getQueryParam('date_from', date('Y-m-01'));
    $dateTo = getQueryParam('date_to', date('Y-m-d'));
    $limit = min(50, max(5, (int) getQueryParam('limit', 10)));

    $stmt = $pdo->prepare(
        "SELECT 
            si.product_id,
            si.product_name,
            SUM(si.quantity) as total_qty,
            SUM(si.line_total) as total_revenue,
            SUM(si.unit_cost * si.quantity) as total_cost,
            COUNT(DISTINCT si.sale_id) as transaction_count
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE DATE(s.sold_at) BETWEEN :from AND :to
         GROUP BY si.product_id, si.product_name
         ORDER BY total_revenue DESC
         LIMIT :limit"
    );
    $stmt->bindValue(':from', $dateFrom);
    $stmt->bindValue(':to', $dateTo);
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->execute();
    $products = $stmt->fetchAll();

    jsonResponse([
        'date_from' => $dateFrom,
        'date_to' => $dateTo,
        'products' => $products,
    ]);
}

function getPaymentSummary(PDO $pdo): void {
    $dateFrom = getQueryParam('date_from', date('Y-m-01'));
    $dateTo = getQueryParam('date_to', date('Y-m-d'));

    $stmt = $pdo->prepare(
        "SELECT 
            pm.name as payment_method,
            COUNT(s.id) as transaction_count,
            SUM(s.total_amount) as total_amount
         FROM sales s
         JOIN payment_methods pm ON s.payment_method_id = pm.id
         WHERE DATE(s.sold_at) BETWEEN :from AND :to
         GROUP BY pm.id, pm.name
         ORDER BY total_amount DESC"
    );
    $stmt->execute([':from' => $dateFrom, ':to' => $dateTo]);
    $summary = $stmt->fetchAll();

    jsonResponse([
        'date_from' => $dateFrom,
        'date_to' => $dateTo,
        'payment_methods' => $summary,
    ]);
}
