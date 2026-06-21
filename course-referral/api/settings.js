import { getData, setData } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    // Public: registration page needs this to show account numbers
    const data = await getData();
    return res.status(200).json(data.settings);
  }

  if (req.method === 'POST') {
    // Admin only: update account details
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { telebirr, cbe } = req.body;

    if (!telebirr || !telebirr.number || !telebirr.number.trim()) {
      return res.status(400).json({ error: 'Telebirr number is required' });
    }
    if (!cbe || !cbe.number || !cbe.number.trim()) {
      return res.status(400).json({ error: 'CBE account number is required' });
    }

    const data = await getData();
    data.settings = {
      telebirr: {
        number: telebirr.number.trim(),
        holder: (telebirr.holder || '').trim() || 'Ghost Digitals Academy'
      },
      cbe: {
        number: cbe.number.trim(),
        holder: (cbe.holder || '').trim() || 'Ghost Digitals Academy'
      }
    };
    await setData(data);
    return res.status(200).json({ ok: true, settings: data.settings });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
