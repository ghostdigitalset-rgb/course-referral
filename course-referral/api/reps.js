import { getData, setData } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const data = await getData();

  if (req.method === 'POST') {
    const { name, phone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    const rep = {
      id: 'rep_' + Date.now(),
      name: name.trim(),
      phone: (phone || '').trim(),
      signups: 0,
      createdAt: new Date().toISOString()
    };
    data.reps.push(rep);
    await setData(data);
    return res.status(201).json(rep);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID required' });
    data.reps = data.reps.filter(r => r.id !== id);
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
