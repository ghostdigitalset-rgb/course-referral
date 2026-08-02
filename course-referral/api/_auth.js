// Shared admin authentication.
//
// The x-admin-key header can be one of two things:
//   1. The super-admin password (process.env.ADMIN_PASSWORD) — full access, permanent.
//   2. A stored admin's credentials in the form "username:password" — full access
//      EXCEPT managing other admins.
//
// Stored admins live in data.settings.admins as:
//   { username, password, createdAt, createdBy }

export function verifyAdmin(adminKey, data) {
  if (!adminKey) return { ok: false };

  const superPass = process.env.ADMIN_PASSWORD;
  if (superPass && adminKey === superPass) {
    return { ok: true, isSuper: true, username: 'super' };
  }

  // Stored admin: "username:password"
  const sep = adminKey.indexOf(':');
  if (sep > 0) {
    const username = adminKey.slice(0, sep);
    const password = adminKey.slice(sep + 1);
    const admins = (data && data.settings && data.settings.admins) || [];
    const match = admins.find(a => a.username === username && a.password === password);
    if (match) {
      return { ok: true, isSuper: false, username: match.username };
    }
  }

  return { ok: false };
}
