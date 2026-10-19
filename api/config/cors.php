<?php
/**
 * CORS Configuration
 * 
 * Allows requests from Vite dev server during development.
 * In production, the frontend is served from the same origin.
 */

function setCorsHeaders(): void {
    $allowedOrigins = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
    ];

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    if (in_array($origin, $allowedOrigins, true)) {
        header("Access-Control-Allow-Origin: $origin");
    }

    // Also allow same-network requests (for mobile devices in production)
    if (empty($origin) || isLocalNetworkOrigin($origin)) {
        header("Access-Control-Allow-Origin: *");
    }

    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Accept, X-Device-ID');
    header('Access-Control-Max-Age: 86400');

    // Handle preflight
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

/**
 * Check if origin is from local network
 */
function isLocalNetworkOrigin(string $origin): bool {
    $host = parse_url($origin, PHP_URL_HOST);
    if (!$host) return false;

    // Common local network patterns
    if (str_starts_with($host, '192.168.')) return true;
    if (str_starts_with($host, '10.')) return true;
    if (preg_match('/^172\.(1[6-9]|2[0-9]|3[0-1])\./', $host)) return true;
    if ($host === 'localhost' || $host === '127.0.0.1') return true;

    return false;
}
