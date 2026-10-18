<?php
// Port of _seats.js. Each course has its own round with In-person and Online seats.
const DEFAULT_ROUND_ID = 'r1';

function round_id_for(array $s, string $courseId): string {
    $v = $s['roundIds'][$courseId] ?? null;
    if (!$v) $v = $s['round'] ?? null; // students saved by the earlier single-round version
    return $v ? (string)$v : DEFAULT_ROUND_ID;
}

function is_confirmed(array $s): bool {
    return ($s['paid'] ?? false) === true || ($s['paymentStatus'] ?? '') === 'verified';
}

function covers_course(array $s, string $courseId): bool {
    $key = (string)($s['course'] ?? '');
    if ($key === '') return false;
    if (in_array($key, ['all', 'all3', 'both'], true)) return true;
    if ($key === $courseId) return true;
    if (strpos($key, '+') !== false) return in_array($courseId, explode('+', $key), true);
    return false;
}

function taken_seats(array $students, array $course, string $classType): int {
    $cid = (string)$course['id'];
    $rid = $course['round']['id'] ?? DEFAULT_ROUND_ID;
    $n = 0;
    foreach ($students as $s) {
        $ct = ($s['classType'] ?? '') ?: 'in-person';
        if (is_confirmed($s) && (($s['status'] ?? '') !== 'dropped') && covers_course($s, $cid)
            && round_id_for($s, $cid) === $rid && $ct === $classType) {
            $n++;
        }
    }
    return $n;
}

// total 0 means unlimited (left is null)
function seat_info(array $students, array $course, string $classType): array {
    $total = (int)($course['round']['seats'][$classType] ?? 0);
    $taken = taken_seats($students, $course, $classType);
    return ['total' => $total, 'taken' => $taken, 'left' => $total > 0 ? max(0, $total - $taken) : null];
}

function course_ids_for(string $courseKey, array $dynamic): array {
    $ids = array_map(fn($c) => (string)$c['id'], $dynamic);
    if ($courseKey === 'all' || $courseKey === 'all3') return $ids;
    return array_values(array_filter(explode('+', $courseKey), fn($k) => in_array($k, $ids, true)));
}
