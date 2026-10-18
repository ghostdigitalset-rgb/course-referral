<?php
// Port of register.js course resolution. The price is always computed on the server.
const BASE_FEES = ['digital' => 10000, 'event' => 8000, 'ai' => 10000];
const BASE_LABELS = ['digital' => 'Digital Marketing', 'event' => 'Event Organizing', 'ai' => 'Applied AI'];
const BUNDLE_PRICE = 25000;
const PAYMENT_METHODS = ['telebirr' => 'Telebirr', 'cbe' => 'CBE', 'cash' => 'Cash'];
const PAIR_BUNDLES = [
    ['courses' => ['social media marketing', 'event organizing'], 'price' => 10000, 'label' => 'Social Media Marketing + Event Organizing'],
    ['courses' => ['canva for beginners', 'applied ai'], 'price' => 8500, 'label' => 'Canva for Beginners + Applied AI'],
];

function norm_name($s): string { return preg_replace('/\s+/', ' ', strtolower(trim((string)$s))); }

function match_pair_bundle(array $selected): ?array {
    if (count($selected) !== 2) return null;
    $names = array_map(fn($c) => norm_name($c['name'] ?? ''), $selected);
    sort($names);
    foreach (PAIR_BUNDLES as $pair) {
        $target = array_map('norm_name', $pair['courses']);
        sort($target);
        if ($names === $target) return $pair;
    }
    return null;
}

function dyn_price(array $c): float {
    return (float)(($c['price'] ?? 0) ?: ($c['fee'] ?? 0));
}

function dyn_by_id(array $dynamic, string $id): ?array {
    foreach ($dynamic as $c) if ((string)$c['id'] === $id) return $c;
    return null;
}

// Returns ['courseKey','courseLabel','fee'] or null.
function resolve_course(string $course, ?string $courseLabel, array $dynamic, float $bundleDiscount): ?array {
    if ($course === 'all') {
        if (count($dynamic) >= 1) {
            $raw = array_sum(array_map('dyn_price', $dynamic));
            $fee = $bundleDiscount > 0 ? (int)round($raw * (1 - $bundleDiscount / 100)) : (int)$raw;
            return ['courseKey' => 'all', 'courseLabel' => $courseLabel ?: 'All courses', 'fee' => $fee];
        }
        return ['courseKey' => 'all3', 'courseLabel' => $courseLabel ?: 'All 3 courses', 'fee' => BUNDLE_PRICE];
    }
    if ($course === 'all3' || $course === 'both') {
        return ['courseKey' => 'all3', 'courseLabel' => $courseLabel ?: 'All 3 courses', 'fee' => BUNDLE_PRICE];
    }
    if (isset(BASE_FEES[$course])) {
        return ['courseKey' => $course, 'courseLabel' => $courseLabel ?: BASE_LABELS[$course], 'fee' => BASE_FEES[$course]];
    }
    $dyn = dyn_by_id($dynamic, $course);
    if ($dyn) {
        return ['courseKey' => (string)$dyn['id'], 'courseLabel' => $courseLabel ?: ($dyn['name'] ?? (string)$dyn['id']), 'fee' => (int)dyn_price($dyn)];
    }
    if ($course !== '' && strpos($course, '+') !== false) {
        $ids = array_map(fn($c) => (string)$c['id'], $dynamic);
        $parts = array_values(array_filter(explode('+', $course), fn($p) => isset(BASE_FEES[$p]) || in_array($p, $ids, true)));
        if (count($parts) < 2) return null;

        $all3 = count(array_intersect(['digital', 'event', 'ai'], $parts)) === 3;
        $allDynamic = count($dynamic) >= 2 && count(array_intersect($ids, $parts)) === count($ids);

        if (!$allDynamic) {
            $selected = array_values(array_filter(array_map(fn($k) => dyn_by_id($dynamic, $k), $parts)));
            $pair = match_pair_bundle($selected);
            if ($pair) return ['courseKey' => $course, 'courseLabel' => $courseLabel ?: $pair['label'], 'fee' => $pair['price']];
        }

        $computed = 0;
        foreach ($parts as $k) {
            if (isset(BASE_FEES[$k])) $computed += BASE_FEES[$k];
            else { $dc = dyn_by_id($dynamic, $k); $computed += $dc ? dyn_price($dc) : 0; }
        }
        if ($all3) $computed = BUNDLE_PRICE;
        elseif ($allDynamic && $bundleDiscount > 0) $computed = (int)round($computed * (1 - $bundleDiscount / 100));

        $labels = array_map(function ($k) use ($dynamic) {
            if (isset(BASE_LABELS[$k])) return BASE_LABELS[$k];
            $dc = dyn_by_id($dynamic, $k);
            return $dc ? $dc['name'] : $k;
        }, $parts);
        $computedLabel = ($all3 || $allDynamic) ? 'All courses' : implode(' + ', $labels);

        return [
            'courseKey' => $all3 ? 'all3' : ($allDynamic ? 'all' : $course),
            'courseLabel' => $courseLabel ?: $computedLabel,
            'fee' => (int)$computed,
        ];
    }
    return null;
}

function generate_portal_id(array $existing): string {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do {
        $id = 'GDA-';
        for ($i = 0; $i < 6; $i++) $id .= $chars[random_int(0, strlen($chars) - 1)];
    } while (isset($existing[$id]));
    return $id;
}
