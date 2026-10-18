<?php
// One-time import from the Vercel/Upstash export. Run from the command line on the server:
//   php import.php /path/to/export
// The export folder must contain app-data.json, files-manifest.json and the files/ folder
// produced by export-data.mjs. Delete this file after the import.
if (php_sapi_name() !== 'cli') { http_response_code(403); exit('Run from the command line only.'); }
require_once __DIR__ . '/lib/bootstrap.php';

$dir = $argv[1] ?? null;
if (!$dir || !is_file("$dir/app-data.json")) exit("Usage: php import.php <export folder>\n");

$data = json_decode(file_get_contents("$dir/app-data.json"), true);
if (!is_array($data)) exit("app-data.json is not valid JSON\n");
$manifest = json_decode(file_get_contents("$dir/files-manifest.json") ?: '{}', true)['manifest'] ?? [];
$savedAs = [];
foreach ($manifest as $m) $savedAs[$m['originalUrl']] = $m['savedAs'];

$copied = 0; $missing = [];
// Payment proofs: copy into the private folder, keeping the same pathname.
foreach ($data['students'] ?? [] as $i => $s) {
    if (empty($s['proofUrl'])) continue;
    $src = isset($savedAs[$s['proofUrl']]) ? "$dir/files/" . $savedAs[$s['proofUrl']] : null;
    $pathname = $s['proofPathname'] ?: ('payment-proof/' . basename(parse_url($s['proofUrl'], PHP_URL_PATH) ?: 'proof'));
    if ($src && is_file($src)) {
        $dest = cfg()['private_dir'] . '/' . $pathname;
        @mkdir(dirname($dest), 0700, true);
        copy($src, $dest);
        $copied++;
    } else {
        $missing[] = $s['proofUrl'];
    }
    $data['students'][$i]['proofPathname'] = $pathname;
    $data['students'][$i]['proofUrl'] = '/api/proof?file=' . rawurlencode($pathname);
}
// Course PDFs: copy into the public folder.
foreach ($data['settings']['courses'] ?? [] as $i => $c) {
    if (empty($c['pdfUrl'])) continue;
    $src = isset($savedAs[$c['pdfUrl']]) ? "$dir/files/" . $savedAs[$c['pdfUrl']] : null;
    $name = basename(parse_url($c['pdfUrl'], PHP_URL_PATH) ?: 'course.pdf');
    if ($src && is_file($src)) {
        $dest = cfg()['public_upload_dir'] . '/course-pdf/' . $name;
        @mkdir(dirname($dest), 0755, true);
        copy($src, $dest);
        $data['settings']['courses'][$i]['pdfUrl'] = cfg()['public_upload_url'] . '/course-pdf/' . $name;
        $copied++;
    } else {
        $missing[] = $c['pdfUrl'];
    }
}

set_data($data);
echo "Imported: " . count($data['students'] ?? []) . " students, " . count($data['reps'] ?? []) . " reps, "
   . count($data['settings']['courses'] ?? []) . " courses. Files copied: $copied.\n";
if ($missing) echo "Files not found in export (" . count($missing) . "):\n  " . implode("\n  ", $missing) . "\n";
echo "Delete import.php now.\n";
