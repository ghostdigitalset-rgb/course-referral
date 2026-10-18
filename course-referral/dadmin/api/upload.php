<?php
require_once __DIR__ . '/../lib/bootstrap.php';

start_api('POST', 'Content-Type, x-filename');
if (method() !== 'POST') respond(405, ['error' => 'Method not allowed']);

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = [
    'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp',
    'image/heic' => 'heic', 'image/heif' => 'heif', 'application/pdf' => 'pdf',
];

$raw = file_get_contents('php://input', false, null, 0, MAX_BYTES + 1);
if ($raw === false || $raw === '') respond(400, ['error' => 'No file received']);
if (strlen($raw) > MAX_BYTES) respond(400, ['error' => 'File too large. Max size is 4MB']);

// Decide the type from the file's contents, not from what the browser says.
$finfo = new finfo(FILEINFO_MIME_TYPE);
$mime = $finfo->buffer($raw);
if ($mime === 'image/jpg') $mime = 'image/jpeg';
if (!isset(ALLOWED[$mime])) respond(400, ['error' => 'Please upload a JPG, PNG, WEBP, HEIC image or PDF (got: ' . ($mime ?: 'unknown') . ')']);

$isPdf = $mime === 'application/pdf';
$folder = $isPdf ? 'course-pdf' : 'payment-proof';
$name = time() . '-' . bin2hex(random_bytes(4)) . '.' . ALLOWED[$mime];
$pathname = $folder . '/' . $name;

if ($isPdf) {
    // Course PDFs are public (students open them from the classroom).
    $dir = cfg()['public_upload_dir'] . '/course-pdf';
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    file_put_contents($dir . '/' . $name, $raw);
    respond(200, ['ok' => true, 'url' => cfg()['public_upload_url'] . '/' . $pathname, 'pathname' => $pathname]);
}

// Payment proofs stay private and are served only to the admin through proof.php.
$dir = cfg()['private_dir'] . '/payment-proof';
if (!is_dir($dir)) mkdir($dir, 0700, true);
file_put_contents($dir . '/' . $name, $raw);
respond(200, ['ok' => true, 'url' => '/api/proof?file=' . rawurlencode($pathname), 'pathname' => $pathname]);
