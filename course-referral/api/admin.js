import { getData, setData } from './_store.js';
import { verifyAdmin } from './_auth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminKey = req.headers['x-admin-key'];
  const data = await getData();
  const auth = verifyAdmin(adminKey, data);

  if (!auth.ok) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── GET: return all app data plus who's logged in ──
  if (req.method === 'GET') {
    return res.status(200).json({ ...data, _auth: { isSuper: auth.isSuper, username: auth.username } });
  }

  // ── POST: admin management actions (super admin only) ──
  if (req.method === 'POST') {
    const action = req.body?.action;

    if (action === 'list-admins') {
      if (!auth.isSuper) return res.status(403).json({ error: 'Only the super admin can manage admins' });
      const admins = (data.settings?.admins || []).map(a => ({
        username: a.username,
        createdAt: a.createdAt || null,
        createdBy: a.createdBy || null,
      }));
      return res.status(200).json({ admins });
    }

    if (action === 'add-admin') {
      if (!auth.isSuper) return res.status(403).json({ error: 'Only the super admin can add admins' });
      const username = (req.body.username || '').trim();
      const password = (req.body.password || '').trim();
      if (!username) return res.status(400).json({ error: 'Username is required' });
      if (username.includes(':')) return res.status(400).json({ error: 'Username cannot contain a colon (:)' });
      if (username.toLowerCase() === 'super') return res.status(400).json({ error: 'That username is reserved' });
      if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

      if (!data.settings) data.settings = {};
      if (!Array.isArray(data.settings.admins)) data.settings.admins = [];

      if (data.settings.admins.some(a => a.username.toLowerCase() === username.toLowerCase())) {
        return res.status(400).json({ error: 'An admin with that username already exists' });
      }

      data.settings.admins.push({
        username,
        password,
        createdAt: new Date().toISOString(),
        createdBy: auth.username,
      });
      await setData(data);
      return res.status(201).json({ ok: true });
    }

    if (action === 'update-admin-password') {
      if (!auth.isSuper) return res.status(403).json({ error: 'Only the super admin can change admin passwords' });
      const username = (req.body.username || '').trim();
      const password = (req.body.password || '').trim();
      if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
      const admin = (data.settings?.admins || []).find(a => a.username === username);
      if (!admin) return res.status(404).json({ error: 'Admin not found' });
      admin.password = password;
      await setData(data);
      return res.status(200).json({ ok: true });
    }

    if (action === 'change-master-password') {
      if (!auth.isSuper) return res.status(403).json({ error: 'Only the super admin can change the master password' });
      const newPassword = (req.body.newPassword || '').trim();
      if (newPassword.length < 6) return res.status(400).json({ error: 'Master password must be at least 6 characters' });
      if (newPassword.includes(':')) return res.status(400).json({ error: 'Master password cannot contain a colon (:)' });
      if (!data.settings) data.settings = {};
      data.settings.masterPassword = newPassword;
      await setData(data);
      return res.status(200).json({ ok: true });
    }

    if (action === 'remove-admin') {
      if (!auth.isSuper) return res.status(403).json({ error: 'Only the super admin can remove admins' });
      const username = (req.body.username || '').trim();
      const admins = data.settings?.admins || [];
      const idx = admins.findIndex(a => a.username === username);
      if (idx === -1) return res.status(404).json({ error: 'Admin not found' });
      admins.splice(idx, 1);
      await setData(data);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
