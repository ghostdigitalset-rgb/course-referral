import { getData, setData } from './_store.js';

const TEACHER_CREDENTIALS = {
  'digital':  { password: process.env.TEACHER_DIGITAL_PASS  || 'TeacherDM2026',  course: 'digital',  label: 'Digital Marketing' },
  'event':    { password: process.env.TEACHER_EVENT_PASS    || 'TeacherEV2026',  course: 'event',    label: 'Event Organizing' },
  'ai':       { password: process.env.TEACHER_AI_PASS       || 'TeacherAI2026',  course: 'ai',       label: 'Applied AI' },
};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-teacher-key, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const data = await getData();
  if (!data.sessions) data.sessions = [];
  if (!data.sessionCodes) data.sessionCodes = [];

  // ── Teacher login ─────────────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'login') {
    const { username, password } = req.body;
    const teacher = TEACHER_CREDENTIALS[username];
    if (!teacher || teacher.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    return res.status(200).json({ ok: true, username, course: teacher.course, label: teacher.label });
  }

  // ── Verify teacher key ────────────────────────────────────
  const teacherKey = req.headers['x-teacher-key'];
  const adminKey   = req.headers['x-admin-key'];
  let teacherCourse = null;

  if (teacherKey) {
    const teacher = TEACHER_CREDENTIALS[teacherKey];
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    teacherCourse = teacher.course;
  } else if (adminKey !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── GET sessions & codes ──────────────────────────────────
  if (req.method === 'GET') {
    let sessions = data.sessions || [];
    let codes    = data.sessionCodes || [];
    if (teacherCourse) {
      sessions = sessions.filter(s => s.course === teacherCourse);
      codes    = codes.filter(c => c.course === teacherCourse);
    }
    return res.status(200).json({ ok: true, sessions, codes });
  }

  // ── POST: create session ──────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'create-session') {
    const { title, description, materials, sessionNumber } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const course = teacherCourse || req.body.course;
    const teacher = Object.values(TEACHER_CREDENTIALS).find(t => t.course === course);

    const session = {
      id:            's_' + Date.now(),
      course,
      courseLabel:   teacher?.label || course,
      sessionNumber: sessionNumber || (data.sessions.filter(s => s.course === course).length + 1),
      title,
      description:   description || '',
      materials:     materials || [],
      createdAt:     new Date().toISOString(),
      active:        true,
    };
    data.sessions.push(session);
    await setData(data);
    return res.status(201).json({ ok: true, session });
  }

  // ── POST: generate codes for a session ───────────────────
  if (req.method === 'POST' && req.query.action === 'generate-codes') {
    const { sessionId, count } = req.body;
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (teacherCourse && session.course !== teacherCourse) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const numCodes = Math.min(parseInt(count) || 1, 100);
    const newCodes = [];
    const existingCodes = new Set((data.sessionCodes || []).map(c => c.code));

    for (let i = 0; i < numCodes; i++) {
      let code;
      do { code = generateCode(); } while (existingCodes.has(code));
      existingCodes.add(code);

      const codeObj = {
        id:        'c_' + Date.now() + '_' + i,
        code,
        sessionId,
        course:    session.course,
        usedBy:    null,
        usedAt:    null,
        active:    true,
        createdAt: new Date().toISOString(),
      };
      newCodes.push(codeObj);
    }

    data.sessionCodes = [...(data.sessionCodes || []), ...newCodes];
    await setData(data);
    return res.status(201).json({ ok: true, codes: newCodes });
  }

  // ── PATCH: deactivate codes (bulk or single) ──────────────
  if (req.method === 'PATCH' && req.query.action === 'deactivate-codes') {
    const { sessionId, codeIds } = req.body;
    data.sessionCodes = (data.sessionCodes || []).map(c => {
      if (sessionId && c.sessionId === sessionId) return { ...c, active: false };
      if (codeIds && codeIds.includes(c.id)) return { ...c, active: false };
      return c;
    });
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── PATCH: toggle session active ──────────────────────────
  if (req.method === 'PATCH' && req.query.action === 'toggle-session') {
    const { sessionId } = req.body;
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Not found' });
    session.active = !session.active;
    await setData(data);
    return res.status(200).json({ ok: true, active: session.active });
  }

  // ── DELETE: delete session ────────────────────────────────
  if (req.method === 'DELETE') {
    const { sessionId } = req.body;
    data.sessions    = (data.sessions || []).filter(s => s.id !== sessionId);
    data.sessionCodes = (data.sessionCodes || []).filter(c => c.sessionId !== sessionId);
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
