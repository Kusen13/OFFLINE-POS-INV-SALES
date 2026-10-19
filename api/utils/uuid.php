<?php
/**
 * UUID Validation Utilities
 */

/**
 * Validate UUID v4 format
 */
function isValidUuid(string $uuid): bool {
    return (bool) preg_match(
        '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i',
        $uuid
    );
}
