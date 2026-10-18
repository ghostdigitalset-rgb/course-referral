<?php
// Shared helpers for every API endpoint: database, data store, JSON replies, auth.

$GLOBALS['CONFIG'] = require dirname(__DIR__) . '/config.php';

function cfg(): array { return $GLOBALS['CONFIG']; }

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $c = cfg()['db'];
        $pdo = new PDO(
            "mysql:host={$c['host']};dbname={$c['name']};charset=utf8mb4",
            $c['user'], $c['pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
    }
    return $pdo;
}

// Throws on a database error. It must not return an empty record, or the next save would wipe the data.
function get_data(): array {
    $row = db()->query('SELECT data FROM app_data WHERE id = 1')->fetch();
    if (!$row) return ['reps' => [], 'students' => []];
    $d = json_decode($row['data'], true);
    return is_array($d) ? $d : ['reps' => [], 'students' => []];
}

function set_data(array $data): void {
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $st = db()->prepare('INSERT INTO app_data (id, data) VALUES (1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)');
    $st->execute([$json]);
}

function respond(int $code, $body): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

// Call first in every endpoint. Answers CORS preflight and handles errors in one place.
function start_api(string $methods, string $headers = 'Content-Type, x-admin-key'): void {
    header('Access-Control-Allow-Origin: *');
    header("Access-Control-Allow-Methods: $methods, OPTIONS");
    header("Access-Control-Allow-Headers: $headers");
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') respond(200, new stdClass());
    set_exception_handler(function ($e) {
        error_log('API error: ' . $e->getMessage());
        respond(500, ['error' => 'Server error. Please try again.']);
    });
}

function method(): string { return $_SERVER['REQUEST_METHOD'] ?? 'GET'; }

function body(): array {
    static $b = null;
    if ($b === null) {
        $j = json_decode(file_get_contents('php://input') ?: '[]', true);
        $b = is_array($j) ? $j : [];
    }
    return $b;
}

function header_val(string $name): ?string {
    $k = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return isset($_SERVER[$k]) ? (string)$_SERVER[$k] : null;
}

function qparam(string $name): ?string {
    return isset($_GET[$name]) ? (string)$_GET[$name] : null;
}

function now_iso(): string {
    return (new DateTime('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
}

function is_num($v): bool { return is_int($v) || is_float($v); }

// Same rules as the Node _auth.js: master password, or "username:password" for a stored admin.
function verify_admin(?string $key, array $data): array {
    if (!$key) return ['ok' => false];
    $web = $data['settings']['masterPassword'] ?? null;
    $eff = $web ?: (cfg()['admin_password'] ?? '');
    if ($eff !== '' && hash_equals((string)$eff, $key)) return ['ok' => true, 'isSuper' => true, 'username' => 'super'];
    $sep = strpos($key, ':');
    if ($sep !== false && $sep > 0) {
        $u = substr($key, 0, $sep);
        $p = substr($key, $sep + 1);
        foreach (($data['settings']['admins'] ?? []) as $a) {
            if (($a['username'] ?? '') === $u && hash_equals((string)($a['password'] ?? ''), $p)) {
                return ['ok' => true, 'isSuper' => false, 'username' => $a['username']];
            }
        }
    }
    return ['ok' => false];
}

function require_admin(array $data): array {
    $auth = verify_admin(header_val('x-admin-key'), $data);
    if (!$auth['ok']) respond(401, ['error' => 'Unauthorized']);
    return $auth;
}
