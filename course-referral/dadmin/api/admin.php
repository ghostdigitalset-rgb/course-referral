<?php
require_once __DIR__ . '/../lib/bootstrap.php';

start_api('GET, POST');
$data = get_data();
$auth = require_admin($data);

if (method() === 'GET') {
    respond(200, array_merge($data, ['_auth' => ['isSuper' => $auth['isSuper'], 'username' => $auth['username']]]));
}
if (method() !== 'POST') respond(405, ['error' => 'Method not allowed']);

$b = body();
$action = $b['action'] ?? null;
$data['settings'] = $data['settings'] ?? [];

if ($action === 'list-admins') {
    if (!$auth['isSuper']) respond(403, ['error' => 'Only the super admin can manage admins']);
    $list = array_map(fn($a) => ['username' => $a['username'], 'createdAt' => $a['createdAt'] ?? null, 'createdBy' => $a['createdBy'] ?? null], $data['settings']['admins'] ?? []);
    respond(200, ['admins' => $list]);
}

if ($action === 'add-admin') {
    if (!$auth['isSuper']) respond(403, ['error' => 'Only the super admin can add admins']);
    $username = trim((string)($b['username'] ?? ''));
    $password = trim((string)($b['password'] ?? ''));
    if ($username === '') respond(400, ['error' => 'Username is required']);
    if (strpos($username, ':') !== false) respond(400, ['error' => 'Username cannot contain a colon (:)']);
    if (strtolower($username) === 'super') respond(400, ['error' => 'That username is reserved']);
    if (mb_strlen($password) < 4) respond(400, ['error' => 'Password must be at least 4 characters']);
    $admins = $data['settings']['admins'] ?? [];
    foreach ($admins as $a) {
        if (strtolower($a['username']) === strtolower($username)) respond(400, ['error' => 'An admin with that username already exists']);
    }
    $admins[] = ['username' => $username, 'password' => $password, 'createdAt' => now_iso(), 'createdBy' => $auth['username']];
    $data['settings']['admins'] = $admins;
    set_data($data);
    respond(201, ['ok' => true]);
}

if ($action === 'update-admin-password') {
    if (!$auth['isSuper']) respond(403, ['error' => 'Only the super admin can change admin passwords']);
    $username = trim((string)($b['username'] ?? ''));
    $password = trim((string)($b['password'] ?? ''));
    if (mb_strlen($password) < 4) respond(400, ['error' => 'Password must be at least 4 characters']);
    $found = false;
    foreach ($data['settings']['admins'] ?? [] as $i => $a) {
        if ($a['username'] === $username) { $data['settings']['admins'][$i]['password'] = $password; $found = true; }
    }
    if (!$found) respond(404, ['error' => 'Admin not found']);
    set_data($data);
    respond(200, ['ok' => true]);
}

if ($action === 'change-master-password') {
    if (!$auth['isSuper']) respond(403, ['error' => 'Only the super admin can change the master password']);
    $new = trim((string)($b['newPassword'] ?? ''));
    if (mb_strlen($new) < 6) respond(400, ['error' => 'Master password must be at least 6 characters']);
    if (strpos($new, ':') !== false) respond(400, ['error' => 'Master password cannot contain a colon (:)']);
    $data['settings']['masterPassword'] = $new;
    set_data($data);
    respond(200, ['ok' => true]);
}

if ($action === 'remove-admin') {
    if (!$auth['isSuper']) respond(403, ['error' => 'Only the super admin can remove admins']);
    $username = trim((string)($b['username'] ?? ''));
    $admins = $data['settings']['admins'] ?? [];
    $kept = array_values(array_filter($admins, fn($a) => $a['username'] !== $username));
    if (count($kept) === count($admins)) respond(404, ['error' => 'Admin not found']);
    $data['settings']['admins'] = $kept;
    set_data($data);
    respond(200, ['ok' => true]);
}

respond(400, ['error' => 'Unknown action']);
