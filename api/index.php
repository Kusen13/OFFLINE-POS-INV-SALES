<?php
/**
 * API Front Controller / Router
 * 
 * All API requests are routed through this file via .htaccess
 * URL pattern: /OFFLINE-POS-INV-SALES/api/{resource}/{id?}/{action?}
 */

// Error handling - don't expose internal errors
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// Set JSON content type for all responses
header('Content-Type: application/json; charset=utf-8');

// Load core utilities
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/config/cors.php';
require_once __DIR__ . '/utils/response.php';
require_once __DIR__ . '/utils/uuid.php';
require_once __DIR__ . '/middleware/validation.php';

// Handle CORS
setCorsHeaders();

// Enforce local network access
enforceLocalNetwork();

// Parse the request - multiple strategies for compatibility
$method = $_SERVER['REQUEST_METHOD'];
$resource = '';
$id = null;
$action = null;

// Strategy 1: Individual query params from .htaccess segment rewriting
// .htaccess: ^(res)/(id)/(action) -> index.php?_r=res&_id=id&_action=action
if (!empty($_GET['_r'])) {
    $resource = $_GET['_r'];
    $id = $_GET['_id'] ?? null;
    $action = $_GET['_action'] ?? null;
}
// Strategy 2: PATH_INFO (e.g., index.php/sync/status)
elseif (!empty($_SERVER['PATH_INFO'])) {
    $segments = explode('/', trim($_SERVER['PATH_INFO'], '/'));
    $resource = $segments[0] ?? '';
    $id = $segments[1] ?? null;
    $action = $segments[2] ?? null;
}
// Strategy 3: Parse REQUEST_URI by stripping base path
else {
    $basePath = '/OFFLINE-POS-INV-SALES/api';
    $requestUri = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
    $path = '';
    $indexPath = $basePath . '/index.php';
    if (str_starts_with($requestUri, $indexPath)) {
        $path = substr($requestUri, strlen($indexPath));
    } elseif (str_starts_with($requestUri, $basePath)) {
        $path = substr($requestUri, strlen($basePath));
    }
    $path = trim($path, '/');
    if ($path) {
        $segments = explode('/', $path);
        $resource = $segments[0] ?? '';
        $id = $segments[1] ?? null;
        $action = $segments[2] ?? null;
    }
}

// Global exception handler
set_exception_handler(function (Throwable $e) {
    error_log('API Error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    jsonError('Internal server error', 500);
});

// Route to appropriate controller
switch ($resource) {
    case 'products':
        require_once __DIR__ . '/controllers/ProductController.php';
        handleProducts($method, $id, $action);
        break;

    case 'categories':
        require_once __DIR__ . '/controllers/CategoryController.php';
        handleCategories($method, $id);
        break;

    case 'sales':
        require_once __DIR__ . '/controllers/SaleController.php';
        handleSales($method, $id);
        break;

    case 'inventory':
        require_once __DIR__ . '/controllers/InventoryController.php';
        handleInventory($method, $id, $action);
        break;

    case 'expenses':
        require_once __DIR__ . '/controllers/ExpenseController.php';
        handleExpenses($method, $id);
        break;

    case 'sync':
        require_once __DIR__ . '/controllers/SyncController.php';
        // URL: /sync/{action} - second segment is the action, not an ID
        handleSync($method, $id);
        break;

    case 'reports':
        require_once __DIR__ . '/controllers/ReportController.php';
        // URL: /reports/{type} - second segment is the report type
        handleReports($method, $id);
        break;

    case 'payment-methods':
        require_once __DIR__ . '/controllers/PaymentMethodController.php';
        handlePaymentMethods($method, $id);
        break;

    case 'settings':
        require_once __DIR__ . '/controllers/SettingController.php';
        handleSettings($method, $id);
        break;

    case 'health':
        // Simple health check endpoint
        $pdo = getDBConnection();
        $pdo->query('SELECT 1');
        jsonResponse([
            'status' => 'ok',
            'timestamp' => date('c'),
            'server' => 'OFFLINE-POS API',
            'php_version' => PHP_VERSION,
        ]);
        break;

    case '':
        jsonResponse([
            'message' => 'OFFLINE-POS-INV-SALES API',
            'version' => '1.0.0',
            'endpoints' => [
                'GET /api/health' => 'Health check',
                'GET /api/products' => 'List products',
                'GET /api/categories' => 'List categories',
                'GET /api/sales' => 'Sales history',
                'GET /api/inventory' => 'Stock levels',
                'GET /api/expenses' => 'Expenses',
                'POST /api/sync/sales' => 'Sync sales from mobile',
                'GET /api/sync/products' => 'Get product updates for mobile',
                'GET /api/reports/{type}' => 'Sales reports',
                'GET /api/payment-methods' => 'Payment methods',
                'GET /api/settings' => 'App settings',
            ]
        ]);
        break;

    default:
        jsonNotFound("Unknown resource: $resource");
}
