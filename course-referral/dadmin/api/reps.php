<?php
require_once __DIR__ . '/../lib/bootstrap.php';

start_api('POST, DELETE');
$data = get_data();
$data['reps'] = $data['reps'] ?? [];
require_admin($data);

if (method() === 'POST') {
    $b = body();
    $name = trim((string)($b['name'] ?? ''));
    if ($name === '') respond(400, ['error' => 'Name is required']);
    $ids = array_column($data['reps'], 'id');
    $id = 'rep_' . round(microtime(true) * 1000);
    while (in_array($id, $ids, true)) $id = 'rep_' . round(microtime(true) * 1000) . random_int(0, 999);
    $rep = ['id' => $id, 'name' => $name, 'phone' => trim((string)($b['phone'] ?? '')), 'createdAt' => now_iso()];
    $data['reps'][] = $rep;
    set_data($data);
    respond(200, $rep);
}

if (method() === 'DELETE') {
    $id = qparam('id');
    if (!$id) respond(400, ['error' => 'Rep id is required']);
    $before = count($data['reps']);
    $data['reps'] = array_values(array_filter($data['reps'], fn($r) => $r['id'] !== $id));
    if (count($data['reps']) === $before) respond(404, ['error' => 'Rep not found']);
    set_data($data);
    respond(200, ['success' => true]);
}

respond(405, ['error' => 'Method not allowed']);
