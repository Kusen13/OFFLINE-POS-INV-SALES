<?php
/**
 * Database Configuration
 * 
 * This file contains database credentials and should NEVER be
 * accessible from the frontend or committed with production credentials.
 */

define('DB_HOST', 'localhost');
define('DB_PORT', 3306);
define('DB_NAME', 'pos_system');
define('DB_USER', 'root');
define('DB_PASS', '');  // Default XAMPP - change in production
define('DB_CHARSET', 'utf8mb4');

/**
 * Get PDO database connection
 * Uses singleton pattern to reuse connection
 */
function getDBConnection(): PDO {
    static $pdo = null;
    
    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            DB_HOST, DB_PORT, DB_NAME, DB_CHARSET
        );
        
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_STRINGIFY_FETCHES  => false,
        ];
        
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode([
                'success' => false,
                'error' => 'Database connection failed',
                'message' => 'Unable to connect to the database. Ensure MySQL is running.'
            ]);
            exit;
        }
    }
    
    return $pdo;
}
