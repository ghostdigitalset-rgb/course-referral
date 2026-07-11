import { getData, setData } from './_store.js';

// Default courses (used only if none saved yet — preserves your original 3)
const DEFAULT_COURSES = [
  { id: 'digital', name: 'Digital Marketing', price: 10000, description: 'Social media, SEO, ads & more', duration: '', icon: '📣' },
  { id: 'event',   name: 'Event Organizing',  price: 8000,  description: 'Planning, logistics & execution', duration: '', icon: '🎪' },
  { id: 'ai',      name: 'Applied AI: Tools, Techniques, and Real-World Use Cases', price: 10000, description: 'AI tools, prompt engineering & practical applications', duration: '', icon: '🤖' }
];

function ensureDefaults(data) {
  if (!data.settings) data.settings = {};
  if (!Array.isArray(data.settings.courses)) data.settings.courses = DEFAULT_COURSES;
  if (typeof data.settings.bundleDiscount !== 'number') data.settings.bundleDiscount = 10; // percent off when ALL courses selected
  if (!data.settings.telebirr) data.settings.telebirr = { number: '', holder: 'Ghost Digitals Academy' };
  if (!data.settings.cbe) data.settings.cbe = { number: '', holder: 'Ghost Digitals Academy' };
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    // Public: registration page needs account numbers + course list
    let data = await getData();
    data = ensureDefaults(data);
    await setData(data);
    return res.status(200).json(data.settings);
  }

  if (req.method === 'POST') {
    // Admin only
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let data = await getData();
    data = ensureDefaults(data);

    const action = req.body?.action || 'payment';

    // ── Save payment (bank) settings ──────────────────────────
    if (action === 'payment') {
      const { telebirr, cbe } = req.body;
      if (!telebirr || !telebirr.number || !telebirr.number.trim()) {
        return res.status(400).json({ error: 'Telebirr number is required' });
      }
      if (!cbe || !cbe.number || !cbe.number.trim()) {
        return res.status(400).json({ error: 'CBE account number is required' });
      }
      data.settings.telebirr = {
        number: telebirr.number.trim(),
        holder: (telebirr.holder || '').trim() || 'Ghost Digitals Academy'
      };
      data.settings.cbe = {
        number: cbe.number.trim(),
        holder: (cbe.holder || '').trim() || 'Ghost Digitals Academy'
      };
      await setData(data);
      return res.status(200).json({ ok: true, settings: data.settings });
    }

    // ── Save courses + bundle discount ────────────────────────
    if (action === 'courses') {
      const { courses, bundleDiscount } = req.body;
      if (!Array.isArray(courses)) {
        return res.status(400).json({ error: 'Courses must be a list' });
      }
      const cleaned = [];
      for (const c of courses) {
        const name = (c.name || '').trim();
        const price = Number(c.price);
        if (!name) return res.status(400).json({ error: 'Every course needs a name' });
        if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: `Invalid price for "${name}"` });
        cleaned.push({
          id: c.id && String(c.id).trim() ? String(c.id).trim() : 'c_' + Date.now() + '_' + cleaned.length,
          name,
          price: Math.round(price),
          description: (c.description || '').trim(),
          duration: (c.duration || '').trim(),
          icon: (c.icon || '📚').trim() || '📚'
        });
      }
      let disc = Number(bundleDiscount);
      if (!Number.isFinite(disc) || disc < 0) disc = 0;
      if (disc > 90) disc = 90; // safety cap
      data.settings.courses = cleaned;
      data.settings.bundleDiscount = Math.round(disc);
      await setData(data);
      return res.status(200).json({ ok: true, settings: data.settings });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
