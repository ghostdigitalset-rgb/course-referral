import { getData, setData } from './_store.js';

function generatePortalId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'GDA-';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key, x-student-id');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action;
  const data = await getData();
  if (!data.students) data.students = [];

  // ── Generate Portal ID (admin only) ──────────────────────
  if (action === 'generate-id') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { studentId } = req.body || (req.method === 'POST' ? await parseJSON(req) : {});
    const id = req.query.studentId || studentId;
    if (!id) return res.status(400).json({ error: 'studentId required' });

    const student = data.students.find(s => s.id === id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Generate unique portal ID
    let portalId;
    let attempts = 0;
    do {
      portalId = generatePortalId();
      attempts++;
    } while (data.students.some(s => s.portalId === portalId) && attempts < 20);

    student.portalId = portalId;
    student.portalActive = true;
    await setData(data);

    return res.status(200).json({ ok: true, portalId });
  }

  return res.status(400).json({ error: 'Unknown action' });
}

async function parseJSON(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}
