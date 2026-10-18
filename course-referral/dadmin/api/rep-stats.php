<?php
require_once __DIR__ . '/../lib/bootstrap.php';

start_api('GET', 'Content-Type');
if (method() !== 'GET') respond(405, ['error' => 'Method not allowed']);

$id = qparam('id');
if (!$id) respond(400, ['error' => 'Rep ID required']);

$data = get_data();
$rep = null;
foreach ($data['reps'] ?? [] as $r) if ($r['id'] === $id) { $rep = $r; break; }
if (!$rep) respond(404, ['error' => 'Sales rep not found. Check your code.']);

$mine = array_values(array_filter($data['students'] ?? [], fn($s) => ($s['ref'] ?? null) === $id));
$breakdown = ['digital' => 0, 'event' => 0, 'both' => 0];
foreach ($mine as $s) { $k = (string)$s['course']; $breakdown[$k] = ($breakdown[$k] ?? 0) + 1; }
$revenue = array_sum(array_map(fn($s) => (float)($s['fee'] ?? 0), $mine));

respond(200, [
    'rep' => ['id' => $rep['id'], 'name' => $rep['name'], 'phone' => $rep['phone'] ?? ''],
    'signups' => count($mine),
    'revenue' => $revenue,
    'breakdown' => $breakdown,
    'students' => array_map(fn($s) => [
        'name' => $s['name'],
        'course' => $s['courseLabel'] ?? null,
        'fee' => $s['fee'] ?? null,
        'date' => $s['date'] ?? null,
        'paid' => $s['paid'] ?? false,
        'paymentStatus' => $s['paymentStatus'] ?? (($s['paid'] ?? false) ? 'verified' : 'pending'),
        'paymentMethodLabel' => $s['paymentMethodLabel'] ?? '',
    ], $mine),
]);
