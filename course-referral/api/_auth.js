// Shared admin authentication.
//
// The x-admin-key header can be one of two things:
//   1. The super-admin master password — full access, including managing admins.
//        - If a web-set master password exists (data.settings.masterPassword), that is
//          the master password.
//        - Otherwise the env var ADMIN_PASSWORD is used as a fallback so you're never
//          locked out before setting one on the web.
//   2. A stored admin's credentials in the form "username:password" — full access
//      EXCEPT managing other admins / the master password.
//
// Stored admins live in data.settings.admins as:
//   { username, password, createdAt, createdBy }

export function verifyAdmin(adminKey, data) {
  if (!adminKey) return { ok: false };

  const webMaster = data && data.settings && data.settings.masterPassword;
  const envMaster = process.env.ADMIN_PASSWORD;
  // Once a web master password is set, it takes over. Until then, fall back to the env var.
  const effectiveMaster = webMaster || envMaster;

  if (effectiveMaster && adminKey === effectiveMaster) {
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
