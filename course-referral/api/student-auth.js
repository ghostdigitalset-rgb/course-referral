import { getData, setData } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data = await getData();
  if (!data.sessionCodes) data.sessionCodes = [];
  if (!data.sessions) data.sessions = [];

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code is required' });

  const normalized = code.trim().toUpperCase();
  const codeObj = data.sessionCodes.find(c => c.code === normalized);

  if (!codeObj) return res.status(404).json({ error: 'Invalid code. Please check and try again.' });
  if (!codeObj.active) return res.status(403).json({ error: 'This code has been deactivated.' });
  if (codeObj.usedBy) return res.status(403).json({ error: 'This code has already been used by another student.' });

  // Find the session
  const session = data.sessions.find(s => s.id === codeObj.sessionId);
  if (!session || !session.active) {
    return res.status(403).json({ error: 'This session is no longer active.' });
  }

  // Mark code as used
  const studentId = 'stu_' + Date.now();
  codeObj.usedBy = studentId;
  codeObj.usedAt = new Date().toISOString();
  await setData(data);

  return res.status(200).json({
    ok: true,
    studentId,
    session: {
      id:            session.id,
      title:         session.title,
      sessionNumber: session.sessionNumber,
      description:   session.description,
      materials:     session.materials,
      courseLabel:   session.courseLabel,
    },
    code: normalized,
  });
}
