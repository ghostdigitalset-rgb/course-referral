<?php
require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/register_core.php';

start_api('GET, POST, PATCH', 'Content-Type, x-admin-key, x-student-id');
$data = get_data();
$data['students'] = $data['students'] ?? [];
$action = qparam('action');

if ($action === 'generate-id') {
    require_admin($data);
    $b = body();
    $id = qparam('studentId') ?: ($b['studentId'] ?? null);
    if (!$id) respond(400, ['error' => 'studentId required']);
    $idx = null;
    foreach ($data['students'] as $i => $s) if ((string)$s['id'] === (string)$id) $idx = $i;
    if ($idx === null) respond(404, ['error' => 'Student not found']);
    $existing = [];
    foreach ($data['students'] as $s) if (!empty($s['portalId'])) $existing[$s['portalId']] = true;
    $portalId = generate_portal_id($existing);
    $data['students'][$idx]['portalId'] = $portalId;
    $data['students'][$idx]['portalActive'] = true;
    set_data($data);
    respond(200, ['ok' => true, 'portalId' => $portalId]);
}

respond(400, ['error' => 'Unknown action']);
