<?php
require_once __DIR__ . '/../lib/bootstrap.php';

start_api('GET', 'Content-Type, x-admin-key');
if (method() !== 'GET') respond(405, ['error' => 'Method not allowed']);

$data = get_data();
require_admin($data);

// Find the file: by student id (normal), or by its pathname (from the upload response).
$pathname = null;
if ($id = qparam('id')) {
    foreach ($data['students'] ?? [] as $s) {
        if ((string)$s['id'] === $id && !empty($s['proofPathname'])) $pathname = $s['proofPathname'];
    }
    if (!$pathname) respond(404, ['error' => 'No proof of payment on file']);
} elseif ($file = qparam('file')) {
    $pathname = $file;
} else {
    respond(400, ['error' => 'Student ID required']);
}

// Only allow files inside the proof folder, with no path tricks.
if (strpos($pathname, 'payment-proof/') !== 0 || strpos($pathname, '..') !== false) respond(400, ['error' => 'Invalid file']);
$base = realpath(cfg()['private_dir']);
$full = realpath(cfg()['private_dir'] . '/' . $pathname);
if ($base === false || $full === false || strpos($full, $base . DIRECTORY_SEPARATOR) !== 0 || !is_file($full)) {
    respond(404, ['error' => 'Proof file not found']);
}

$mime = (new finfo(FILEINFO_MIME_TYPE))->file($full) ?: 'application/octet-stream';
header('Content-Type: ' . $mime);
header('Cache-Control: private, no-cache');
header('X-Content-Type-Options: nosniff');
header('Content-Length: ' . filesize($full));
readfile($full);
exit;
