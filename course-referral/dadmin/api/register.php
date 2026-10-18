<?php
require_once __DIR__ . '/../lib/bootstrap.php';
require_once __DIR__ . '/../lib/seats.php';
require_once __DIR__ . '/../lib/register_core.php';

start_api('POST', 'Content-Type, x-admin-key');
if (method() !== 'POST') respond(405, ['error' => 'Method not allowed']);

$b = body();
$str = fn($k) => trim((string)($b[$k] ?? ''));
if ($str('name') === '') respond(400, ['error' => 'Name is required']);
if ($str('phone') === '') respond(400, ['error' => 'Phone is required']);

$data = get_data();
$allCourses = $data['settings']['courses'] ?? [];
$bundleDiscount = (float)($data['settings']['bundleDiscount'] ?? 0);

// Only a logged-in admin can send a manual entry. Public visitors always go through proof of payment.
$isAdmin = verify_admin(header_val('x-admin-key'), $data)['ok'];
$isManual = !empty($b['manualEntry']) && $isAdmin;

$dynamic = $isAdmin ? $allCourses : array_values(array_filter($allCourses, fn($c) => empty($c['hidden'])));

$resolved = resolve_course((string)($b['course'] ?? ''), $str('courseLabel') ?: null, $dynamic, $bundleDiscount);
if (!$resolved) respond(400, ['error' => 'Invalid course selection']);

$ct = ($b['classType'] ?? '') === 'online' ? 'online' : 'in-person';
$students = $data['students'] ?? [];
$roundIds = [];
foreach (course_ids_for($resolved['courseKey'], $dynamic) as $cid) {
    $c = dyn_by_id($dynamic, $cid);
    if (!$c) continue;
    $round = $c['round'] ?? [];
    if (!$isManual) {
        if (!$isAdmin && (($round['open'] ?? true) === false)) {
            respond(403, ['error' => "Registration for {$c['name']} is closed right now. Please check back for the next round."]);
        }
        $info = seat_info($students, $c, $ct);
        if ($info['left'] === 0) {
            respond(409, ['error' => "Sorry, " . ($ct === 'online' ? 'online' : 'in-person') . " seats are full for {$c['name']} (" . (($round['label'] ?? '') ?: 'this round') . ")."]);
        }
    }
    $roundIds[(string)$c['id']] = (string)(($round['id'] ?? '') ?: DEFAULT_ROUND_ID);
}

$method = $str('paymentMethod');
if ($method === '' || !isset(PAYMENT_METHODS[$method])) respond(400, ['error' => 'Please select a payment method']);
if (!$isManual && $str('proofPathname') === '') respond(400, ['error' => 'Please attach your proof of payment']);

$existingIds = [];
foreach ($students as $s) if (!empty($s['portalId'])) $existingIds[$s['portalId']] = true;
$portalId = generate_portal_id($existingIds);

$isVerified = $isManual && (($b['paymentStatus'] ?? '') === 'verified');
$age = $b['age'] ?? null;
$student = [
    'id' => 's_' . round(microtime(true) * 1000),
    'name' => $str('name'),
    'phone' => $str('phone'),
    'email' => $str('email'),
    'age' => ($age !== null && $age !== '') ? (int)$age : null,
    'gender' => in_array($b['gender'] ?? '', ['Male', 'Female'], true) ? $b['gender'] : '',
    'guardian' => $str('guardian'),
    'guardianPhone' => $str('guardianPhone'),
    'address' => $str('address'),
    'notes' => $str('notes'),
    'course' => $resolved['courseKey'],
    'courseLabel' => $resolved['courseLabel'],
    'fee' => $resolved['fee'],
    'ref' => $str('ref'),
    'paymentMethod' => $method,
    'paymentMethodLabel' => PAYMENT_METHODS[$method],
    'proofUrl' => $str('proofUrl'),
    'proofPathname' => $str('proofPathname'),
    'paymentStatus' => $isVerified ? 'verified' : 'pending',
    'paid' => $isVerified,
    'manualEntry' => $isManual,
    'classType' => $ct,
    'roundIds' => (object)$roundIds,
    'status' => 'ongoing',
    'portalId' => $portalId,
    'portalActive' => true,
    'date' => date('d/m/Y'),
    'createdAt' => now_iso(),
];

$data['students'][] = $student;
if ($student['ref'] !== '') {
    foreach ($data['reps'] ?? [] as $i => $rep) {
        if (($rep['id'] ?? '') === $student['ref']) {
            $data['reps'][$i]['signups'] = (int)($rep['signups'] ?? 0) + 1;
        }
    }
}
set_data($data);
respond(201, array_merge(['ok' => true, 'studentId' => $student['id']], $student));
