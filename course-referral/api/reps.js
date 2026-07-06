import { getData, setData } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Admin password check
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const data = await getData();
  if (!Array.isArray(data.reps)) data.reps = [];

  // ── Add a new rep ──
  if (req.method === 'POST') {
    const { name, phone } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Generate ID matching the original format: rep_<timestamp>
    let id = 'rep_' + Date.now();
    while (data.reps.some((r) => r.id === id)) {
      id = 'rep_' + Date.now() + Math.floor(Math.random() * 1000);
    }

    const rep = {
      id,
      name: String(name).trim(),
      phone: phone ? String(phone).trim() : '',
      createdAt: new Date().toISOString(),
    };

    data.reps.push(rep);
    const ok = await setData(data);
    if (!ok) return res.status(500).json({ error: 'Failed to save rep' });

    return res.status(200).json(rep);
  }

  // ── Remove a rep ──
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Rep id is required' });

    const before = data.reps.length;
    data.reps = data.reps.filter((r) => r.id !== id);
    if (data.reps.length === before) {
      return res.status(404).json({ error: 'Rep not found' });
    }

    const ok = await setData(data);
    if (!ok) return res.status(500).json({ error: 'Failed to remove rep' });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
