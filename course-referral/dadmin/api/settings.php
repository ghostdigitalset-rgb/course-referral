<?php
require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/settings_core.php';

start_api('GET, POST', 'Content-Type, x-admin-key');

if (method() === 'GET') {
    // Public: course list, round state and seats left, account numbers, FAQ
    $data = ensure_defaults(get_data());
    set_data($data);
    $students = $data['students'] ?? [];
    $courses = [];
    foreach ($data['settings']['courses'] as $c) {
        if (!empty($c['hidden'])) continue;
        $round = $c['round'] ?? [];
        unset($c['round'], $c['roundHistory']);
        $c['round'] = public_round(['round' => $round, 'id' => $c['id']], $students);
        $courses[] = $c;
    }
    $settings = $data['settings'];
    unset($settings['roundHistory'], $settings['masterPassword'], $settings['admins']);
    respond(200, array_merge($settings, ['courses' => $courses]));
}

if (method() !== 'POST') respond(405, ['error' => 'Method not allowed']);

$data = ensure_defaults(get_data());
require_admin($data);
$b = body();
$action = $b['action'] ?? 'payment';

function find_course(array &$data, $courseId): ?int {
    foreach ($data['settings']['courses'] as $i => $c) {
        if ((string)$c['id'] === (string)$courseId) return $i;
    }
    return null;
}

if ($action === 'payment') {
    $tb = $b['telebirr'] ?? null;
    $cbe = $b['cbe'] ?? null;
    if (!$tb || trim((string)($tb['number'] ?? '')) === '') respond(400, ['error' => 'Telebirr number is required']);
    if (!$cbe || trim((string)($cbe['number'] ?? '')) === '') respond(400, ['error' => 'CBE account number is required']);
    $data['settings']['telebirr'] = ['number' => trim($tb['number']), 'holder' => trim((string)($tb['holder'] ?? '')) ?: 'Ghost Digitals Academy'];
    $data['settings']['cbe'] = ['number' => trim($cbe['number']), 'holder' => trim((string)($cbe['holder'] ?? '')) ?: 'Ghost Digitals Academy'];
    set_data($data);
    respond(200, ['ok' => true, 'settings' => $data['settings']]);
}

if ($action === 'courses') {
    $courses = $b['courses'] ?? null;
    if (!is_array($courses)) respond(400, ['error' => 'Courses must be a list']);
    $cleaned = [];
    foreach ($courses as $idx => $c) {
        $name = trim((string)($c['name'] ?? ''));
        $price = $c['price'] ?? null;
        if ($name === '') respond(400, ['error' => 'Every course needs a name']);
        if (!is_numeric($price) || (float)$price < 0) respond(400, ['error' => "Invalid price for \"$name\""]);
        $id = trim((string)($c['id'] ?? '')) !== '' ? trim((string)$c['id']) : 'c_' . round(microtime(true) * 1000) . '_' . count($cleaned);
        $existing = find_course($data, $id);
        $ex = $existing !== null ? $data['settings']['courses'][$existing] : null;
        $cleaned[] = [
            'id' => $id,
            'name' => $name,
            'price' => (int)round((float)$price),
            'description' => trim((string)($c['description'] ?? '')),
            'duration' => trim((string)($c['duration'] ?? '')),
            'schedule' => mb_substr(trim((string)($c['schedule'] ?? '')), 0, 160),
            'scheduleOnline' => mb_substr(trim((string)($c['scheduleOnline'] ?? '')), 0, 160),
            'icon' => trim((string)($c['icon'] ?? '')) ?: '📚',
            'hidden' => ($c['hidden'] ?? false) === true,
            'round' => $ex['round'] ?? make_round(DEFAULT_ROUND_ID, '2nd round', true, null),
            'roundHistory' => $ex['roundHistory'] ?? [],
        ];
    }
    $disc = is_numeric($b['bundleDiscount'] ?? null) ? min(90, max(0, (float)$b['bundleDiscount'])) : 0;
    $sitewide = is_numeric($b['discountPercent'] ?? null) ? min(90, max(0, (float)$b['discountPercent'])) : 0;
    $re = '/^\d{4}-\d{2}-\d{2}$/';
    $start = is_string($b['discountStart'] ?? null) && preg_match($re, $b['discountStart']) ? $b['discountStart'] : null;
    $end = is_string($b['discountEnd'] ?? null) && preg_match($re, $b['discountEnd']) ? $b['discountEnd'] : null;

    if (isset($b['faqs']) && is_array($b['faqs'])) {
        $faqs = [];
        foreach (array_slice($b['faqs'], 0, 60) as $f) {
            $q = mb_substr(trim((string)($f['q'] ?? '')), 0, 200);
            $a = mb_substr(trim((string)($f['a'] ?? '')), 0, 1000);
            $kw = [];
            if (is_array($f['keywords'] ?? null)) {
                foreach (array_slice($f['keywords'], 0, 20) as $k) {
                    $k = mb_substr(trim((string)$k), 0, 40);
                    if ($k !== '') $kw[] = $k;
                }
            }
            if ($q !== '' && $a !== '') $faqs[] = ['q' => $q, 'a' => $a, 'keywords' => $kw];
        }
        $data['settings']['faqs'] = $faqs;
    }

    $data['settings']['courses'] = $cleaned;
    $data['settings']['bundleDiscount'] = (int)round($disc);
    $data['settings']['discountPercent'] = (int)round($sitewide);
    $data['settings']['discountStart'] = $start;
    $data['settings']['discountEnd'] = $end;
    if (isset($b['badgeText']) && is_string($b['badgeText'])) $data['settings']['badgeText'] = mb_substr(trim($b['badgeText']), 0, 80);
    set_data($data);
    respond(200, ['ok' => true, 'settings' => $data['settings']]);
}

if ($action === 'course-round' || $action === 'course-new-round') {
    $i = find_course($data, $b['courseId'] ?? '');
    if ($i === null) respond(404, ['error' => 'Course not found. Save courses first.']);
    if ($action === 'course-round') {
        $round = $data['settings']['courses'][$i]['round'];
        apply_round_fields($round, $b);
        $data['settings']['courses'][$i]['round'] = $round;
    } else {
        $prev = $data['settings']['courses'][$i]['round'];
        $data['settings']['courses'][$i]['roundHistory'][] = array_merge($prev, ['open' => false, 'endedAt' => now_iso()]);
        $next = make_round(new_round_id(), 'New round', true, null);
        apply_round_fields($next, $b);
        $data['settings']['courses'][$i]['round'] = $next;
    }
    set_data($data);
    respond(200, ['ok' => true, 'settings' => $data['settings']]);
}

respond(400, ['error' => 'Unknown action']);
