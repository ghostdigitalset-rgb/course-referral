import { getData, setData } from './_store.js';

const TEACHER_CREDENTIALS = {
  'digital': { password: process.env.TEACHER_DIGITAL_PASS || 'TeacherDM2026', course: 'digital', label: 'Digital Marketing' },
  'event':   { password: process.env.TEACHER_EVENT_PASS   || 'TeacherEV2026', course: 'event',   label: 'Event Organizing' },
  'ai':      { password: process.env.TEACHER_AI_PASS      || 'TeacherAI2026', course: 'ai',      label: 'Applied AI' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-teacher-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const data = await getData();
  if (!data.classrooms) data.classrooms = {};
  if (!data.handRaises) data.handRaises = {};

  // ── GET: classroom state (students poll this) ─────────────
  if (req.method === 'GET') {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    const room = data.classrooms[sessionId] || { active: false, roomName: null };
    const hands = data.handRaises[sessionId] || [];
    return res.status(200).json({ ok: true, room, hands });
  }

  // ── POST: start classroom (teacher only) ──────────────────
  if (req.method === 'POST' && req.query.action === 'start') {
    const teacherKey = req.headers['x-teacher-key'];
    const teacher = TEACHER_CREDENTIALS[teacherKey];
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });

    const { sessionId, sessionTitle } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    // Generate unique Jitsi room name
    const roomName = `GDA-${sessionId.replace(/[^a-zA-Z0-9]/g,'')}`.substring(0, 50);

    data.classrooms[sessionId] = {
      active:    true,
      roomName,
      startedAt: new Date().toISOString(),
      course:    teacher.course,
      title:     sessionTitle || 'Class Session',
    };
    data.handRaises[sessionId] = [];
    await setData(data);

    return res.status(200).json({ ok: true, roomName });
  }

  // ── POST: stop classroom ──────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'stop') {
    const teacherKey = req.headers['x-teacher-key'];
    const teacher = TEACHER_CREDENTIALS[teacherKey];
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    const { sessionId } = req.body;
    if (data.classrooms[sessionId]) data.classrooms[sessionId].active = false;
    data.handRaises[sessionId] = [];
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── PATCH: raise/lower hand (student) ────────────────────
  if (req.method === 'PATCH' && req.query.action === 'raise-hand') {
    const { sessionId, studentName, studentCodeId, action } = req.body;
    if (!sessionId || !studentName) return res.status(400).json({ error: 'Missing fields' });
    if (!data.handRaises[sessionId]) data.handRaises[sessionId] = [];

    if (action === 'raise') {
      const already = data.handRaises[sessionId].find(h => h.studentCodeId === studentCodeId);
      if (!already) {
        data.handRaises[sessionId].push({
          studentCodeId,
          studentName,
          raisedAt: new Date().toISOString(),
        });
      }
    } else {
      data.handRaises[sessionId] = data.handRaises[sessionId].filter(h => h.studentCodeId !== studentCodeId);
    }

    await setData(data);
    return res.status(200).json({ ok: true, hands: data.handRaises[sessionId] });
  }

  // ── PATCH: teacher lowers a student's hand ────────────────
  if (req.method === 'PATCH' && req.query.action === 'lower-hand') {
    const teacherKey = req.headers['x-teacher-key'];
    const teacher = TEACHER_CREDENTIALS[teacherKey];
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    const { sessionId, studentCodeId } = req.body;
    if (data.handRaises[sessionId]) {
      data.handRaises[sessionId] = data.handRaises[sessionId].filter(h => h.studentCodeId !== studentCodeId);
    }
    await setData(data);
    return res.status(200).json({ ok: true, hands: data.handRaises[sessionId] || [] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
