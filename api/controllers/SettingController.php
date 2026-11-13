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
            updateSettings($pdo, $id);
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

function updateSettings(PDO $pdo, ?string $id = null): void {
    $data = getJsonBody();

    $stmt = $pdo->prepare(
        'INSERT INTO settings (key_name, value) VALUES (:key, :value) 
         ON DUPLICATE KEY UPDATE value = VALUES(value)'
    );

    if ($id !== null && $id !== '') {
        $cleanKey = sanitizeString((string) $id);
        $val = isset($data['value']) ? $data['value'] : (is_scalar($data) ? $data : json_encode($data));
        $cleanVal = ($cleanKey === 'store_logo' || $cleanKey === 'app_logo')
            ? sanitizeImage((string) $val)
            : sanitizeString((string) $val);

        $stmt->execute([
            ':key' => $cleanKey,
            ':value' => $cleanVal,
        ]);
    } else {
        foreach ($data as $key => $value) {
            $cleanKey = sanitizeString((string) $key);
            $cleanVal = ($cleanKey === 'store_logo' || $cleanKey === 'app_logo')
                ? sanitizeImage((string) $value)
                : sanitizeString((string) $value);

            $stmt->execute([
                ':key' => $cleanKey,
                ':value' => $cleanVal,
            ]);
        }
    }

    getSettings($pdo);
}
