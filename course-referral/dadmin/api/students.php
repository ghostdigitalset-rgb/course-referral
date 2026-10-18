<?php
require_once __DIR__ . '/../lib/bootstrap.php';

start_api('DELETE, PATCH');
$data = get_data();
require_admin($data);
$data['students'] = $data['students'] ?? [];
$id = qparam('id');

if (method() === 'DELETE') {
    $b = body();
    $ids = (isset($b['ids']) && is_array($b['ids']) && count($b['ids']) > 0) ? $b['ids'] : ($id ? [$id] : []);
    if (!$ids) respond(400, ['error' => 'No student ID(s) provided']);
    $set = array_flip(array_map('strval', $ids));
    foreach ($data['students'] as $s) {
        if (isset($set[(string)$s['id']]) && !empty($s['ref'])) {
            foreach ($data['reps'] ?? [] as $i => $r) {
                if ($r['id'] === $s['ref'] && (int)($r['signups'] ?? 0) > 0) $data['reps'][$i]['signups']--;
            }
        }
    }
    $data['students'] = array_values(array_filter($data['students'], fn($s) => !isset($set[(string)$s['id']])));
    set_data($data);
    respond(200, ['ok' => true, 'deleted' => count($ids)]);
}

if (method() === 'PATCH') {
    $b = body();
    $batches = $data['batches'] ?? [];

    if (array_key_exists('assignBatch', $b) && is_array($b['studentIds'] ?? null)) {
        $batch = null;
        if (!empty($b['assignBatch'])) {
            foreach ($batches as $bt) if ($bt['id'] === $b['assignBatch']) $batch = $bt;
            if (!$batch) respond(404, ['error' => 'Batch not found']);
        }
        $set = array_flip(array_map('strval', $b['studentIds']));
        $count = 0;
        foreach ($data['students'] as $i => $s) {
            if (isset($set[(string)$s['id']])) {
                $data['students'][$i]['batchId'] = $batch ? $batch['id'] : null;
                $data['students'][$i]['batchName'] = $batch ? $batch['name'] : null;
                $count++;
            }
        }
        set_data($data);
        respond(200, ['ok' => true, 'updated' => $count]);
    }

    if (!empty($b['studentId']) && isset($b['fields']) && is_array($b['fields'])) {
        $idx = null;
        foreach ($data['students'] as $i => $s) if ((string)$s['id'] === (string)$b['studentId']) $idx = $i;
        if ($idx === null) respond(404, ['error' => 'Student not found']);
        $f = $b['fields'];
        $allowed = ['name','photoUrl','phone','status','email','age','gender','guardian','guardianPhone','address','notes','course','courseLabel','classType','fee','paymentStatus','paymentMethod','paymentMethodLabel','batchId'];
        foreach ($allowed as $k) if (array_key_exists($k, $f)) $data['students'][$idx][$k] = $f[$k];
        if (array_key_exists('batchId', $f)) {
            $batch = null;
            if (!empty($f['batchId'])) foreach ($batches as $bt) if ($bt['id'] === $f['batchId']) $batch = $bt;
            $data['students'][$idx]['batchId'] = $batch ? $batch['id'] : null;
            $data['students'][$idx]['batchName'] = $batch ? $batch['name'] : null;
        }
        if (array_key_exists('paymentStatus', $f)) $data['students'][$idx]['paid'] = $f['paymentStatus'] === 'verified';
        set_data($data);
        respond(200, ['ok' => true, 'student' => $data['students'][$idx]]);
    }

    if (!empty($b['studentId']) && !empty($b['classType'])) {
        $idx = null;
        foreach ($data['students'] as $i => $s) if ((string)$s['id'] === (string)$b['studentId']) $idx = $i;
        if ($idx === null) respond(404, ['error' => 'Student not found']);
        $data['students'][$idx]['classType'] = $b['classType'];
        set_data($data);
        respond(200, ['ok' => true, 'classType' => $b['classType']]);
    }

    if (!$id) respond(400, ['error' => 'Student ID required']);
    $idx = null;
    foreach ($data['students'] as $i => $s) if ((string)$s['id'] === $id) $idx = $i;
    if ($idx === null) respond(404, ['error' => 'Student not found']);
    $status = qparam('status');
    if ($status === 'verified' || $status === 'rejected') {
        $data['students'][$idx]['paymentStatus'] = $status;
        $data['students'][$idx]['paid'] = $status === 'verified';
        set_data($data);
        respond(200, ['ok' => true, 'paymentStatus' => $status, 'paid' => $status === 'verified']);
    }
    $data['students'][$idx]['paid'] = !($data['students'][$idx]['paid'] ?? false);
    set_data($data);
    respond(200, ['ok' => true, 'paid' => $data['students'][$idx]['paid']]);
}

respond(405, ['error' => 'Method not allowed']);
