import { getData, setData } from './_store.js';
import crypto from 'crypto';

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

// Generate rotating QR token (changes every 30 seconds)
function generateQRToken(sessionId, secret) {
  const window = Math.floor(Date.now() / 30000);
  return crypto.createHmac('sha256', secret + sessionId)
    .update(String(window))
    .digest('hex')
    .substring(0, 12);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-teacher-key, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const data = await getData();
  if (!data.sessions) data.sessions = [];
  if (!data.sessionCodes) data.sessionCodes = [];
  if (!data.attendance) data.attendance = [];

  const QR_SECRET = process.env.QR_SECRET || 'ghostdigitals-qr-secret-2026';

  // Teacher login
  if (req.method === 'POST' && req.query.action === 'login') {
    const { username, password } = req.body;
    const teacher = TEACHER_CREDENTIALS[username];
    if (!teacher || teacher.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
    return res.status(200).json({ ok: true, username, course: teacher.course, label: teacher.label });
  }

  // Public: get timer state
  if (req.method === 'GET' && req.query.action === 'timer') {
    const { sessionId } = req.query;
    const session = (data.sessions || []).find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    let timer = session.timer || { paused: true, secondsLeft: (session.durationMinutes || 45) * 60, lastUpdated: null };
    if (!timer.paused && timer.lastUpdated) {
      const elapsed = Math.floor((Date.now() - timer.lastUpdated) / 1000);
      timer = { ...timer, secondsLeft: Math.max(0, timer.secondsLeft - elapsed) };
    }
    return res.status(200).json({ ok: true, timer, sessionActive: session.active });
  }

  // Public: get QR token for attendance (teacher screen)
  if (req.method === 'GET' && req.query.action === 'qr-token') {
    const { sessionId } = req.query;
    const session = (data.sessions || []).find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const token = generateQRToken(sessionId, QR_SECRET);
    const expiresIn = 30 - (Math.floor(Date.now() / 1000) % 30);
    return res.status(200).json({ ok: true, token, sessionId, expiresIn });
  }

  // Public: mark attendance via QR scan
  if (req.method === 'POST' && req.query.action === 'attend') {
    const { token, sessionId, studentCodeId } = req.body;
    if (!token || !sessionId || !studentCodeId) return res.status(400).json({ error: 'Missing fields' });

    // Verify token (accept current and previous 30s window)
    const currentToken  = generateQRToken(sessionId, QR_SECRET);
    const prevWindow    = Math.floor(Date.now() / 30000) - 1;
    const prevToken     = crypto.createHmac('sha256', QR_SECRET + sessionId).update(String(prevWindow)).digest('hex').substring(0, 12);

    if (token !== currentToken && token !== prevToken) {
      return res.status(403).json({ error: 'QR code expired. Ask your teacher to refresh the screen.' });
    }

    // Find student code
    const code = (data.sessionCodes || []).find(c => c.id === studentCodeId && c.sessionId === sessionId);
    if (!code) return res.status(404).json({ error: 'Student not found for this session' });

    // Check already attended
    const alreadyMarked = (data.attendance || []).find(a => a.studentCodeId === studentCodeId && a.sessionId === sessionId);
    if (alreadyMarked) return res.status(200).json({ ok: true, alreadyMarked: true, studentName: code.studentName });

    // Mark attendance
    const record = {
      id:            'att_' + Date.now(),
      sessionId,
      studentCodeId,
      studentName:   code.studentName || 'Unknown',
      studentPhone:  code.studentPhone || '',
      markedAt:      new Date().toISOString(),
    };
    data.attendance.push(record);
    await setData(data);
    return res.status(200).json({ ok: true, studentName: code.studentName, markedAt: record.markedAt });
  }

  // Verify teacher/admin
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

  // GET sessions, codes, attendance
  if (req.method === 'GET') {
    let sessions   = data.sessions || [];
    let codes      = data.sessionCodes || [];
    let attendance = data.attendance || [];
    if (teacherCourse) {
      sessions   = sessions.filter(s => s.course === teacherCourse);
      codes      = codes.filter(c => c.course === teacherCourse);
      const sessionIds = new Set(sessions.map(s => s.id));
      attendance = attendance.filter(a => sessionIds.has(a.sessionId));
    }
    return res.status(200).json({ ok: true, sessions, codes, attendance });
  }

  // POST: create session
  if (req.method === 'POST' && req.query.action === 'create-session') {
    const { title, description, materials, sessionNumber, durationMinutes } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const course = teacherCourse || req.body.course;
    const teacher = Object.values(TEACHER_CREDENTIALS).find(t => t.course === course);
    const duration = parseInt(durationMinutes) || 45;
    const session = {
      id: 's_' + Date.now(),
      course,
      courseLabel: teacher?.label || course,
      sessionNumber: sessionNumber || (data.sessions.filter(s => s.course === course).length + 1),
      title, description: description || '', materials: materials || [],
      durationMinutes: duration,
      timer: { paused: true, secondsLeft: duration * 60, lastUpdated: null },
      createdAt: new Date().toISOString(),
      active: true,
    };
    data.sessions.push(session);
    await setData(data);
    return res.status(201).json({ ok: true, session });
  }

  // POST: generate codes (now with student info)
  if (req.method === 'POST' && req.query.action === 'generate-codes') {
    const { sessionId, count, students } = req.body;
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (teacherCourse && session.course !== teacherCourse) return res.status(403).json({ error: 'Forbidden' });

    const existingCodes = new Set((data.sessionCodes || []).map(c => c.code));
    const newCodes = [];

    // If students provided (from admin), create one code per student
    if (students && students.length) {
      for (let i = 0; i < students.length; i++) {
        let code;
        do { code = generateCode(); } while (existingCodes.has(code));
        existingCodes.add(code);
        newCodes.push({
          id: 'c_' + Date.now() + '_' + i,
          code, sessionId,
          course: session.course,
          studentId:    students[i].id || null,
          studentName:  students[i].name || null,
          studentPhone: students[i].phone || null,
          usedBy: null, usedAt: null,
          active: true,
          createdAt: new Date().toISOString(),
        });
      }
    } else {
      // Generic codes (no student assigned)
      const numCodes = Math.min(parseInt(count) || 1, 100);
      for (let i = 0; i < numCodes; i++) {
        let code;
        do { code = generateCode(); } while (existingCodes.has(code));
        existingCodes.add(code);
        newCodes.push({ id: 'c_' + Date.now() + '_' + i, code, sessionId, course: session.course, studentId: null, studentName: null, studentPhone: null, usedBy: null, usedAt: null, active: true, createdAt: new Date().toISOString() });
      }
    }

    data.sessionCodes = [...(data.sessionCodes || []), ...newCodes];
    await setData(data);
    return res.status(201).json({ ok: true, codes: newCodes });
  }

  // PATCH: timer control
  if (req.method === 'PATCH' && req.query.action === 'timer') {
    const { sessionId, command, addMinutes, setMinutes } = req.body;
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (teacherCourse && session.course !== teacherCourse) return res.status(403).json({ error: 'Forbidden' });
    if (!session.timer) session.timer = { paused: true, secondsLeft: (session.durationMinutes || 45) * 60, lastUpdated: null };
    const now = Date.now();
    if (!session.timer.paused && session.timer.lastUpdated) {
      const elapsed = Math.floor((now - session.timer.lastUpdated) / 1000);
      session.timer.secondsLeft = Math.max(0, session.timer.secondsLeft - elapsed);
    }
    session.timer.lastUpdated = now;
    if (command === 'pause')  session.timer.paused = true;
    if (command === 'resume') session.timer.paused = false;
    if (command === 'reset')  { session.timer.paused = true; session.timer.secondsLeft = (session.durationMinutes || 45) * 60; }
    if (addMinutes) session.timer.secondsLeft = Math.max(0, session.timer.secondsLeft + (parseInt(addMinutes) * 60));
    if (setMinutes) { session.timer.secondsLeft = parseInt(setMinutes) * 60; session.durationMinutes = parseInt(setMinutes); }
    await setData(data);
    return res.status(200).json({ ok: true, timer: session.timer });
  }

  // PATCH: deactivate codes
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

  // PATCH: toggle session
  if (req.method === 'PATCH' && req.query.action === 'toggle-session') {
    const { sessionId } = req.body;
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Not found' });
    session.active = !session.active;
    await setData(data);
    return res.status(200).json({ ok: true, active: session.active });
  }

  // DELETE
  if (req.method === 'DELETE') {
    const { sessionId } = req.body;
    data.sessions     = (data.sessions || []).filter(s => s.id !== sessionId);
    data.sessionCodes = (data.sessionCodes || []).filter(c => c.sessionId !== sessionId);
    data.attendance   = (data.attendance || []).filter(a => a.sessionId !== sessionId);
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
