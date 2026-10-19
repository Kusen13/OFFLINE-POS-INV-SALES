<?php
/**
 * Input Validation & Sanitization Middleware
 */

/**
 * Get and decode JSON request body
 */
function getJsonBody(): array {
    $rawBody = file_get_contents('php://input');
    if (empty($rawBody)) {
        return [];
    }
    
    $data = json_decode($rawBody, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        jsonError('Invalid JSON in request body', 400);
    }
    
    return $data ?? [];
}

/**
 * Validate required fields exist in data
 */
function validateRequired(array $data, array $fields): array {
    $errors = [];
    foreach ($fields as $field) {
        if (!isset($data[$field]) || (is_string($data[$field]) && trim($data[$field]) === '')) {
            $errors[] = "Field '$field' is required";
        }
    }
    return $errors;
}

/**
 * Sanitize string input
 */
function sanitizeString(?string $value): ?string {
    if ($value === null) return null;
    return htmlspecialchars(trim($value), ENT_QUOTES, 'UTF-8');
}

/**
 * Validate and sanitize decimal value
 */
function sanitizeDecimal(mixed $value): ?float {
    if ($value === null || $value === '') return null;
    $clean = filter_var($value, FILTER_VALIDATE_FLOAT);
    return $clean !== false ? round($clean, 2) : null;
}

/**
 * Validate and sanitize integer value
 */
function sanitizeInt(mixed $value): ?int {
    if ($value === null || $value === '') return null;
    $clean = filter_var($value, FILTER_VALIDATE_INT);
    return $clean !== false ? $clean : null;
}

/**
 * Get query parameter with default
 */
function getQueryParam(string $key, mixed $default = null): mixed {
    return $_GET[$key] ?? $default;
}

/**
 * Get pagination parameters from query string
 */
function getPagination(): array {
    $page = max(1, (int) getQueryParam('page', 1));
    $perPage = min(100, max(1, (int) getQueryParam('per_page', 20)));
    $offset = ($page - 1) * $perPage;
    
    return [
        'page' => $page,
        'per_page' => $perPage,
        'offset' => $offset,
    ];
}

/**
 * Restrict API access to local network only
 */
function enforceLocalNetwork(): void {
    $remoteIp = $_SERVER['REMOTE_ADDR'] ?? '';
    
    // Allow localhost
    if (in_array($remoteIp, ['127.0.0.1', '::1'], true)) {
        return;
    }
    
    // Allow private network ranges
    if (filter_var($remoteIp, FILTER_VALIDATE_IP, FILTER_FLAG_NO_RES_RANGE)) {
        // IP is NOT in a reserved range, so it's public — block it
        if (!filter_var($remoteIp, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE)) {
            return; // It IS private — allow
        }
        jsonError('Access denied: API restricted to local network', 403);
    }
}
