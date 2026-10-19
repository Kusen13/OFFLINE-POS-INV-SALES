<?php
/**
 * JSON Response Helpers
 */

/**
 * Send a JSON success response
 */
function jsonResponse(mixed $data, int $statusCode = 200): void {
    http_response_code($statusCode);
    echo json_encode([
        'success' => true,
        'data' => $data
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Send a paginated JSON response
 */
function jsonPaginatedResponse(array $data, int $total, int $page, int $perPage): void {
    http_response_code(200);
    echo json_encode([
        'success' => true,
        'data' => $data,
        'pagination' => [
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'total_pages' => (int) ceil($total / $perPage),
        ]
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Send a JSON error response
 */
function jsonError(string $message, int $statusCode = 400, ?array $errors = null): void {
    http_response_code($statusCode);
    $response = [
        'success' => false,
        'error' => $message
    ];
    if ($errors !== null) {
        $response['errors'] = $errors;
    }
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * Send a 404 response
 */
function jsonNotFound(string $message = 'Resource not found'): void {
    jsonError($message, 404);
}

/**
 * Send a 405 response
 */
function jsonMethodNotAllowed(): void {
    jsonError('Method not allowed', 405);
}
