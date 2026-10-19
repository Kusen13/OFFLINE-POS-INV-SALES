<?php
/**
 * Setting Controller
 */

function handleSettings(string $method, ?string $id): void {
    $pdo = getDBConnection();

    switch ($method) {
        case 'GET':
            getSettings($pdo);
            break;
        case 'PUT':
            updateSettings($pdo);
            break;
        default:
            jsonMethodNotAllowed();
    }
}

function getSettings(PDO $pdo): void {
    $stmt = $pdo->query('SELECT key_name, value FROM settings');
    $settings = [];
    while ($row = $stmt->fetch()) {
        $settings[$row['key_name']] = $row['value'];
    }
    jsonResponse($settings);
}

function updateSettings(PDO $pdo): void {
    $data = getJsonBody();

    $stmt = $pdo->prepare(
        'INSERT INTO settings (key_name, value) VALUES (:key, :value) 
         ON DUPLICATE KEY UPDATE value = VALUES(value)'
    );

    foreach ($data as $key => $value) {
        $stmt->execute([
            ':key' => sanitizeString($key),
            ':value' => sanitizeString((string) $value),
        ]);
    }

    getSettings($pdo);
}
