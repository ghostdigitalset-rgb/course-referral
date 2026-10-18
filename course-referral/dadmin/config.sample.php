<?php
// Copy this file to config.php on the server and fill in the values.
// config.php must NOT be shared or committed to GitHub.
return [
    'db' => [
        'host' => 'localhost',
        'name' => 'YOUR_DB_NAME',
        'user' => 'YOUR_DB_USER',
        'pass' => 'YOUR_DB_PASSWORD',
    ],
    // Master admin password. Used until a master password is set in the admin page.
    'admin_password' => 'CHANGE_ME',
    // Teacher logins for the three built-in courses.
    'teacher' => [
        'digital' => 'CHANGE_ME',
        'event'   => 'CHANGE_ME',
        'ai'      => 'CHANGE_ME',
    ],
    'qr_secret' => 'CHANGE_ME_RANDOM_STRING',
    // Payment proofs: must be OUTSIDE public_html so nobody can browse them.
    'private_dir' => dirname(__DIR__) . '/private_uploads',
    // Course PDFs: web folder that students can open from the classroom.
    'public_upload_dir' => __DIR__ . '/uploads',
    'public_upload_url' => '/uploads',
];
