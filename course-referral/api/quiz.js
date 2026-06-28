import { getData, setData } from './_store.js';

const TEACHER_CREDENTIALS = {
  'digital': { password: process.env.TEACHER_DIGITAL_PASS || 'TeacherDM2026', course: 'digital', label: 'Digital Marketing' },
  'event':   { password: process.env.TEACHER_EVENT_PASS   || 'TeacherEV2026', course: 'event',   label: 'Event Organizing' },
  'ai':      { password: process.env.TEACHER_AI_PASS      || 'TeacherAI2026', course: 'ai',      label: 'Applied AI' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-teacher-key, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const teacherKey = req.headers['x-teacher-key'];
  const teacher = TEACHER_CREDENTIALS[teacherKey];
  if (!teacher) return res.status(401).json({ error: 'Unauthorized' });

  const data = await getData();
  if (!data.sessions) data.sessions = [];
  if (!data.quizResults) data.quizResults = [];

  // ── POST: create/update quiz for a session ────────────────
  if (req.method === 'POST') {
    const { sessionId, title, questions, timeLimit } = req.body;
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.course !== teacher.course) return res.status(403).json({ error: 'Forbidden' });

    // Validate questions
    if (!questions || !questions.length) return res.status(400).json({ error: 'Questions required' });

    session.quiz = {
      id:          'quiz_' + Date.now(),
      title:       title || `${session.title} — Quiz`,
      questions:   questions.map((q, i) => ({
        id:             'q_' + i,
        type:           q.type || 'multiple-choice', // multiple-choice | true-false
        question:       q.question,
        options:        q.options || [],
        correctAnswer:  q.correctAnswer,
      })),
      timeLimit:   parseInt(timeLimit) || 30,
      createdAt:   new Date().toISOString(),
    };

    await setData(data);
    return res.status(200).json({ ok: true, quiz: session.quiz });
  }

  // ── GET: quiz results for a session ──────────────────────
  if (req.method === 'GET') {
    const { sessionId } = req.query;
    const results = (data.quizResults || []).filter(r => r.sessionId === sessionId);
    const session = data.sessions.find(s => s.id === sessionId);
    return res.status(200).json({ ok: true, results, quiz: session?.quiz || null });
  }

  // ── PATCH: unlock/lock session for students ───────────────
  if (req.method === 'PATCH' && req.query.action === 'unlock-session') {
    const { sessionId } = req.body;
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.course !== teacher.course) return res.status(403).json({ error: 'Forbidden' });
    session.unlockedForStudents = !session.unlockedForStudents;
    await setData(data);
    return res.status(200).json({ ok: true, unlocked: session.unlockedForStudents });
  }

  // ── PATCH: set page range for session ────────────────────
  if (req.method === 'PATCH' && req.query.action === 'set-pages') {
    const { sessionId, pageStart, pageEnd } = req.body;
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.course !== teacher.course) return res.status(403).json({ error: 'Forbidden' });
    session.pageStart = parseInt(pageStart);
    session.pageEnd   = parseInt(pageEnd);
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── DELETE: remove quiz ───────────────────────────────────
  if (req.method === 'DELETE') {
    const { sessionId } = req.body;
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.course !== teacher.course) return res.status(403).json({ error: 'Forbidden' });
    delete session.quiz;
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
