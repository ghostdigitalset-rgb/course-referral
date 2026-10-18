<?php
// Port of settings.js helpers: defaults, migration, round and public views.
require_once __DIR__ . '/seats.php';

const DEFAULT_COURSES = [
    ['id' => 'digital', 'name' => 'Digital Marketing', 'price' => 10000, 'description' => 'Social media, SEO, ads & more', 'duration' => '', 'icon' => '📣'],
    ['id' => 'event', 'name' => 'Event Organizing', 'price' => 8000, 'description' => 'Planning, logistics & execution', 'duration' => '', 'icon' => '🎪'],
    ['id' => 'ai', 'name' => 'Applied AI: Tools, Techniques, and Real-World Use Cases', 'price' => 10000, 'description' => 'AI tools, prompt engineering & practical applications', 'duration' => '', 'icon' => '🤖'],
];

const DEFAULT_FAQS = [
    ['q' => 'How do I register?', 'a' => 'Choose your course, pick In-Person or Online, pay through Telebirr or CBE, and upload your receipt. Our team confirms your payment after that.', 'keywords' => ['sign up', 'enroll', 'join', 'apply']],
    ['q' => 'How do I pay?', 'a' => 'You can pay by Telebirr or CBE Bank. Send the course fee to the account shown on the registration page, then upload your screenshot or receipt.', 'keywords' => ['payment', 'pay', 'telebirr', 'cbe', 'bank']],
    ['q' => 'Can I attend online?', 'a' => 'Yes. Choose Online when you register and you will join the classes by video call.', 'keywords' => ['online', 'remote', 'video', 'virtual']],
    ['q' => 'Who do I contact for help?', 'a' => 'Message us on Telegram at @GhostDigitalsAcademySupport, or call +251 98 534 0983.', 'keywords' => ['contact', 'help', 'support', 'telegram', 'phone']],
];

function clean_seats($v): int { return max(0, (int)round((float)($v ?? 0))); }

function new_round_id(): string { return 'r' . base_convert((string)round(microtime(true) * 1000), 10, 36); }

function make_round(string $id, ?string $label, $open, $seats): array {
    return [
        'id' => $id,
        'label' => $label ?: '2nd round',
        'open' => $open !== false,
        'seats' => ['in-person' => clean_seats($seats['in-person'] ?? null), 'online' => clean_seats($seats['online'] ?? null)],
        'createdAt' => now_iso(),
    ];
}

function ensure_defaults(array $data): array {
    if (!isset($data['settings']) || !is_array($data['settings'])) $data['settings'] = [];
    $s = &$data['settings'];
    if (!is_array($s['courses'] ?? null)) $s['courses'] = DEFAULT_COURSES;
    if (!is_array($s['faqs'] ?? null)) $s['faqs'] = DEFAULT_FAQS;
    if (!is_num($s['bundleDiscount'] ?? null)) $s['bundleDiscount'] = 10;
    if (!is_num($s['discountPercent'] ?? null)) $s['discountPercent'] = 0;
    if (!array_key_exists('discountStart', $s)) $s['discountStart'] = null;
    if (!array_key_exists('discountEnd', $s)) $s['discountEnd'] = null;
    if (!is_string($s['badgeText'] ?? null)) $s['badgeText'] = '';

    // Migrate the old single site-wide round into each course.
    $legacy = $s['currentRound'] ?? null;
    foreach ($s['courses'] as $i => $c) {
        if (!isset($c['round'])) {
            $c['round'] = $legacy
                ? make_round((string)($legacy['id'] ?? DEFAULT_ROUND_ID), $legacy['label'] ?? null, $legacy['open'] ?? true, $legacy['seats'] ?? null)
                : make_round(DEFAULT_ROUND_ID, trim((string)($s['roundLabel'] ?? '')) ?: '2nd round', ($s['registrationOpen'] ?? true) !== false, null);
        }
        if (!is_array($c['roundHistory'] ?? null)) $c['roundHistory'] = [];
        $s['courses'][$i] = $c;
    }
    unset($s['currentRound'], $s['roundHistory'], $s['roundLabel'], $s['registrationOpen']);
    if (!isset($s['telebirr'])) $s['telebirr'] = ['number' => '', 'holder' => 'Ghost Digitals Academy'];
    if (!isset($s['cbe'])) $s['cbe'] = ['number' => '', 'holder' => 'Ghost Digitals Academy'];
    unset($s);
    return $data;
}

function public_round(array $course, array $students): array {
    $round = $course['round'] ?? [];
    $inP = seat_info($students, $course, 'in-person');
    $onl = seat_info($students, $course, 'online');
    return [
        'id' => $round['id'] ?? null,
        'label' => $round['label'] ?? null,
        'open' => ($round['open'] ?? true) !== false,
        'seats' => ['in-person' => $inP['total'], 'online' => $onl['total']],
        'seatsLeft' => ['in-person' => $inP['left'], 'online' => $onl['left']],
    ];
}

function apply_round_fields(array &$round, array $body): void {
    if (isset($body['label']) && is_string($body['label']) && trim($body['label']) !== '') {
        $round['label'] = mb_substr(trim($body['label']), 0, 40);
    }
    if (isset($body['open']) && is_bool($body['open'])) $round['open'] = $body['open'];
    if (isset($body['seats']) && is_array($body['seats'])) {
        $round['seats'] = ['in-person' => clean_seats($body['seats']['in-person'] ?? null), 'online' => clean_seats($body['seats']['online'] ?? null)];
    }
}
