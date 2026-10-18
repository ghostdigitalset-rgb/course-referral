# Moving the academy to DirectAdmin (PHP version)

1. **Database:** In DirectAdmin, create a MySQL database and user (MySQL Management). Open phpMyAdmin and run `schema.sql`.
2. **Config:** Copy `config.sample.php` to `config.php` and fill in the database details, admin password, teacher passwords and QR secret. Never share this file.
3. **Private folder:** Create `private_uploads/` in your home folder, one level above `public_html`. Payment proofs are stored there.
4. **Upload:** Put everything in this folder into `public_html/` (keep the folder structure). Also upload the website pages (`index.html`, `register.html`, etc.).
5. **PHP version:** In DirectAdmin > Multi-PHP Manager, choose PHP 8.1 or newer for the domain.
6. **Import:** Run the export script on your computer first (`export-data.mjs`). Then on the server, from the command line: `php import.php <export folder>`. If SSH isn't available, ask me for a web-based import instead.
7. **Delete** `import.php` after the import.
8. **Test:** landing page, a test registration, the admin login, teacher login, proof upload and viewing.
9. **Domain:** point ghostdigitalacademy.pro.et to this hosting (DirectAdmin > DNS Management) only after the tests pass.

Still to port: `sessions.js` (classroom, attendance, quizzes, teacher login) and `upload-course.js`.
