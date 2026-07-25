import { getData, setData } from './_store.js';
import { put } from '@vercel/blob';
import crypto from 'crypto';

const TEACHER_CREDENTIALS = {
  'digital': { password: process.env.TEACHER_DIGITAL_PASS || 'TeacherDM2026', course: 'digital', label: 'Digital Marketing' },
  'event':   { password: process.env.TEACHER_EVENT_PASS   || 'TeacherEV2026', course: 'event',   label: 'Event Organizing' },
  'ai':      { password: process.env.TEACHER_AI_PASS      || 'TeacherAI2026', course: 'ai',      label: 'Applied AI' },
};

// Build the full teacher map: the 3 built-in logins PLUS one per course
// created in the course manager (stored in data.teacherAuth, keyed by course id).
// A dynamic entry for a built-in key can override its password, but built-ins
// always remain as a fallback so nothing ever locks out.
function teacherMap(data) {
  const map = { ...TEACHER_CREDENTIALS };
  const courses = data?.settings?.courses || [];
  const auth = data?.teacherAuth || {};
  for (const c of courses) {
    const key = String(c.id);
    map[key] = {
      password: auth[key]?.password || map[key]?.password || null,
      course: key,
      label: c.name || map[key]?.label || key,
      dynamic: true,
    };
  }
  return map;
}
function resolveTeacher(key, data) {
  if (!key) return null;
  return teacherMap(data)[key] || null;
}

export const config = { api: { bodyParser: false } };

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateQRToken(sessionId, secret) {
  const window = Math.floor(Date.now() / 30000);
  return crypto.createHmac('sha256', secret + sessionId).update(String(window)).digest('hex').substring(0, 12);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseMultipart(req) {
  const buffer = await readBody(req);
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) throw new Error('No boundary found');
  const boundary = boundaryMatch[1].trim();
  const boundaryBuf = Buffer.from('--' + boundary);

  let fileBuffer = null, fileName = 'course.pdf', duration = 45, teacherKey = '', modulesText = '', batchId = '';
  let pos = 0;

  while (pos < buffer.length) {
    const bp = buffer.indexOf(boundaryBuf, pos);
    if (bp === -1) break;
    pos = bp + boundaryBuf.length;
    if (buffer[pos] === 0x0d && buffer[pos+1] === 0x0a) pos += 2;
    else if (buffer[pos] === 0x0a) pos += 1;
    if (buffer[pos] === 0x2d && buffer[pos+1] === 0x2d) break;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    const headerStr = buffer.slice(pos, headerEnd).toString('utf8');
    pos = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundaryBuf, pos);
    const bodyEnd = nextBoundary === -1 ? buffer.length : nextBoundary - 2;
    const body = buffer.slice(pos, bodyEnd);
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const fileNameMatch = headerStr.match(/filename="([^"]+)"/);
    const fieldName = nameMatch?.[1];
    if (fileNameMatch && fieldName === 'pdf') { fileName = fileNameMatch[1]; fileBuffer = body; }
    else if (fieldName === 'duration') duration = parseInt(body.toString('utf8').trim()) || 45;
    else if (fieldName === 'teacherKey') teacherKey = body.toString('utf8').trim();
    else if (fieldName === 'modules') modulesText = body.toString('utf8').trim();
    else if (fieldName === 'batchId') batchId = body.toString('utf8').trim();
    pos = nextBoundary === -1 ? buffer.length : nextBoundary;
  }
  return { fileBuffer, fileName, duration, teacherKey, modulesText, batchId };
}

async function parseJSON(req) {
  const buf = await readBody(req);
  try { return JSON.parse(buf.toString()); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-teacher-key, x-admin-key, x-student-id');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const QR_SECRET = process.env.QR_SECRET || 'ghostdigitals-qr-secret-2026';
  const data = await getData();
  if (!data.sessions) data.sessions = [];
  if (!data.batches) data.batches = [];
  if (!data.sessionCodes) data.sessionCodes = [];
  if (!data.attendance) data.attendance = [];
  if (!data.classrooms) data.classrooms = {};
  if (!data.handRaises) data.handRaises = {};
  if (!data.quizResults) data.quizResults = [];
  if (!data.studentNotes) data.studentNotes = {};
  if (!data.highlights) data.highlights = {};
  if (!data.studentQuestions) data.studentQuestions = [];

  const action = req.query.action;
  const teacherKey = req.headers['x-teacher-key'];
  const adminKey = req.headers['x-admin-key'];
  const studentId = req.headers['x-student-id'];

  // ── Teacher login ─────────────────────────────────────────
  if (req.method === 'POST' && action === 'login') {
    const body = await parseJSON(req);
    const teacher = resolveTeacher(body.username, data);
    if (!teacher || !teacher.password || teacher.password !== body.password) return res.status(401).json({ error: 'Invalid credentials' });
    return res.status(200).json({ ok: true, username: body.username, course: teacher.course, label: teacher.label });
  }

  // ── Teacher logins: list (admin) ──────────────────────────
  if (req.method === 'GET' && action === 'teacher-logins') {
    if (adminKey !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    const map = teacherMap(data);
    const builtins = new Set(Object.keys(TEACHER_CREDENTIALS));
    const logins = Object.entries(map).map(([username, t]) => ({
      username,
      label: t.label,
      course: t.course,
      builtin: builtins.has(username),
      hasPassword: !!t.password,
      // Only expose the password for dynamic (course-manager) teachers, so the
      // admin can share it. Built-in passwords stay in env/code and are hidden.
      password: builtins.has(username) ? null : (data.teacherAuth?.[username]?.password || null),
    }));
    return res.status(200).json({ ok: true, logins });
  }
  // ── Teacher logins: set / reset password (admin) ──────────
  if (req.method === 'POST' && action === 'set-teacher-password') {
    if (adminKey !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const username = String(body.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Course/username required' });
    // Must correspond to a real course (or a built-in key).
    const course = (data.settings?.courses || []).find(c => String(c.id) === username);
    if (!course && !TEACHER_CREDENTIALS[username]) return res.status(404).json({ error: 'No matching course for that login.' });
    let password = String(body.password || '').trim();
    if (!password) {
      // Auto-generate a readable password.
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
      password = 'T' + Array.from({length: 9}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
    }
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (!data.teacherAuth) data.teacherAuth = {};
    data.teacherAuth[username] = { password, updatedAt: new Date().toISOString() };
    await setData(data);
    return res.status(200).json({ ok: true, username, password, label: course?.name || TEACHER_CREDENTIALS[username]?.label || username });
  }

  // ── Batches: list (teacher or admin) ──────────────────────
  if (req.method === 'GET' && action === 'batches') {
    if (!teacherKeyValid(teacherKey, data) && adminKey !== process.env.ADMIN_PASSWORD)
      return res.status(401).json({ error: 'Unauthorized' });
    return res.status(200).json({ ok: true, batches: data.batches || [] });
  }
  // ── Batches: create (admin) ───────────────────────────────
  if (req.method === 'POST' && action === 'create-batch') {
    if (adminKey !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    if (!body.name || !body.name.trim()) return res.status(400).json({ error: 'Batch name is required' });
    const batch = {
      id: 'batch_' + Date.now(),
      name: body.name.trim(),
      courses: Array.isArray(body.courses) ? body.courses : [],
      startDate: body.startDate || null,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    data.batches.push(batch);
    await setData(data);
    return res.status(201).json({ ok: true, batch });
  }
  // ── Batches: update (admin) ───────────────────────────────
  if (req.method === 'PATCH' && action === 'update-batch') {
    if (adminKey !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const batch = (data.batches || []).find(b => b.id === body.batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (body.name !== undefined) batch.name = String(body.name).trim() || batch.name;
    if (body.courses !== undefined) batch.courses = Array.isArray(body.courses) ? body.courses : batch.courses;
    if (body.startDate !== undefined) batch.startDate = body.startDate;
    if (body.status !== undefined && ['active', 'archived'].includes(body.status)) batch.status = body.status;
    // Keep denormalized batchName on sessions in sync.
    (data.sessions || []).forEach(s => { if (s.batchId === batch.id) s.batchName = batch.name; });
    await setData(data);
    return res.status(200).json({ ok: true, batch });
  }
  // ── Batches: delete (admin) ───────────────────────────────
  if (req.method === 'DELETE' && action === 'delete-batch') {
    if (adminKey !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    const batchId = req.query.batchId;
    if (!batchId) return res.status(400).json({ error: 'batchId required' });
    // Un-batch any sessions that pointed here (they become legacy/global) so
    // content is never orphaned/hidden by accident.
    (data.sessions || []).forEach(s => { if (s.batchId === batchId) { s.batchId = null; s.batchName = null; } });
    (data.students || []).forEach(st => { if (st.batchId === batchId) { st.batchId = null; st.batchName = null; } });
    data.batches = (data.batches || []).filter(b => b.id !== batchId);
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── Announcements (teacher) ───────────────────────────────
  if (action === 'announcements' && req.method === 'GET') {
    let course = null;
    if (teacherKeyValid(teacherKey, data)) { const t = resolveTeacher(teacherKey, data); course = t ? t.course : null; }
    else if (studentId) { const st = (data.students || []).find(s => s.portalId === studentId); if (st) course = st.course; else return res.status(401).json({ error: 'Unauthorized' }); }
    else if (adminKey !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    const matchCourse = (a) => { if (!course) return true; if (course === 'all' || course === 'all3') return true; return course.split('+').includes(a.course) || course.includes(a.course); };
    const list = (data.announcements || []).filter(matchCourse)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return res.status(200).json({ ok: true, announcements: list });
  }
  if (action === 'announcement' && req.method === 'POST') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const t = resolveTeacher(teacherKey, data);
    const body = await parseJSON(req);
    if (!body.text || !body.text.trim()) return res.status(400).json({ error: 'Message is required' });
    if (!data.announcements) data.announcements = [];
    const ann = { id: 'ann_' + Date.now(), course: t.course, courseLabel: t.label, text: body.text.trim(), createdAt: new Date().toISOString() };
    data.announcements.push(ann);
    await setData(data);
    return res.status(201).json({ ok: true, announcement: ann });
  }
  if (action === 'announcement' && req.method === 'DELETE') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.query.id;
    data.announcements = (data.announcements || []).filter(a => a.id !== id);
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── Teacher roster: students in this teacher's course ──────
  if (action === 'roster' && req.method === 'GET') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const t = resolveTeacher(teacherKey, data);
    const tid = String(t.course);
    const tlabel = (t.label || '').toLowerCase().trim();
    const inCourse = (s) => {
      const c = String(s.course || '');
      if (!c) return false;
      if (c === 'all' || c === 'all3') return true;          // bundle = every course
      if (c === 'both') return tid === 'digital' || tid === 'event';
      const segs = c.split('+').map(x => x.trim());
      if (segs.includes(tid)) return true;                    // exact course id
      // fallbacks for label-based or mismatched stored values
      const clabel = (s.courseLabel || '').toLowerCase().trim();
      if (tlabel && clabel && (clabel === tlabel || clabel.includes(tlabel))) return true;
      if (tlabel && segs.some(x => x.toLowerCase() === tlabel)) return true;
      return false;
    };
    const roster = (data.students || []).filter(inCourse).map(s => ({
      id: s.id, name: s.name, phone: s.phone, photoUrl: s.photoUrl || '', age: s.age || null, gender: s.gender || '',
      portalId: s.portalId || '', batchId: s.batchId || null, batchName: s.batchName || null,
      status: s.status || 'ongoing', classType: s.classType || 'in-person',
    }));
    const _debug = {
      teacherCourse: tid, teacherLabel: t.label,
      totalStudents: (data.students || []).length,
      distinctStudentCourses: [...new Set((data.students || []).map(s => s.course))].slice(0, 20),
    };
    return res.status(200).json({ ok: true, roster, batches: (data.batches || []).filter(b => b.status !== 'archived'), _debug });
  }

  // ── Exams ─────────────────────────────────────────────────
  if (action === 'exams' && req.method === 'GET') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const t = resolveTeacher(teacherKey, data);
    const exams = (data.exams || []).filter(e => e.course === t.course);
    const results = (data.examResults || []).filter(r => exams.some(e => e.id === r.examId));
    return res.status(200).json({ ok: true, exams, results });
  }
  if (action === 'exam' && req.method === 'POST') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const t = resolveTeacher(teacherKey, data);
    const body = await parseJSON(req);
    if (!body.title || !body.title.trim()) return res.status(400).json({ error: 'Exam title is required' });
    if (!Array.isArray(body.questions) || !body.questions.length) return res.status(400).json({ error: 'Add at least one question' });
    if (!data.exams) data.exams = [];
    const now = new Date().toISOString();
    if (body.id) {
      const ex = data.exams.find(e => e.id === body.id && e.course === t.course);
      if (!ex) return res.status(404).json({ error: 'Exam not found' });
      Object.assign(ex, {
        title: body.title.trim(), description: body.description || '',
        timeLimit: parseInt(body.timeLimit) || 0, passMark: parseInt(body.passMark) || 50,
        questions: body.questions, assignType: body.assignType || 'batch',
        batchId: body.batchId || null, studentIds: Array.isArray(body.studentIds) ? body.studentIds : [],
        published: !!body.published, updatedAt: now,
      });
      await setData(data);
      return res.status(200).json({ ok: true, exam: ex });
    }
    const exam = {
      id: 'exam_' + Date.now(), course: t.course, courseLabel: t.label,
      title: body.title.trim(), description: body.description || '',
      timeLimit: parseInt(body.timeLimit) || 0, passMark: parseInt(body.passMark) || 50,
      questions: body.questions, assignType: body.assignType || 'batch',
      batchId: body.batchId || null, studentIds: Array.isArray(body.studentIds) ? body.studentIds : [],
      published: !!body.published, createdAt: now,
    };
    data.exams.push(exam);
    await setData(data);
    return res.status(201).json({ ok: true, exam });
  }
  if (action === 'exam' && req.method === 'DELETE') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.query.id;
    data.exams = (data.exams || []).filter(e => e.id !== id);
    data.examResults = (data.examResults || []).filter(r => r.examId !== id);
    await setData(data);
    return res.status(200).json({ ok: true });
  }
  // Teacher adjusts a result's score (for written answers)
  if (action === 'grade-result' && req.method === 'POST') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const r = (data.examResults || []).find(x => x.id === body.resultId);
    if (!r) return res.status(404).json({ error: 'Result not found' });
    if (body.score !== undefined) r.score = Math.max(0, parseInt(body.score) || 0);
    const exam = (data.exams || []).find(e => e.id === r.examId);
    if (exam) r.passed = r.total ? (r.score / r.total * 100) >= (exam.passMark || 50) : false;
    r.gradedBy = resolveTeacher(teacherKey, data)?.label || 'teacher';
    await setData(data);
    return res.status(200).json({ ok: true, result: r });
  }

  // ── Teacher: lock / unlock exam ──────────────────────────
  if (action === 'lock-exam' && req.method === 'POST') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const t = resolveTeacher(teacherKey, data);
    const body = await parseJSON(req);
    const ex = (data.exams || []).find(e => e.id === body.examId && e.course === t.course);
    if (!ex) return res.status(404).json({ error: 'Exam not found' });
    ex.locked = !!body.locked;
    ex.updatedAt = new Date().toISOString();
    await setData(data);
    return res.status(200).json({ ok: true, locked: ex.locked });
  }

  // ── Student: list assigned exams ─────────────────────────
  if (action === 'student-exams' && req.method === 'GET' && studentId) {
    const student = (data.students || []).find(s => s.portalId === studentId);
    if (!student) return res.status(401).json({ error: 'Unauthorized' });
    const allExams = (data.exams || []).filter(ex => {
      if (!ex.published) return false;
      if (ex.locked) return false;
      if (!matchesCourse(ex.course, student.course)) return false;
      if (ex.assignType === 'student') return (ex.studentIds || []).includes(student.id);
      if (ex.assignType === 'batch') return !ex.batchId || ex.batchId === student.batchId;
      return true;
    });
    const results = (data.examResults || []);
    const exams = allExams.map(ex => {
      const myResult = results.find(r => r.examId === ex.id && r.studentId === student.id);
      return {
        id: ex.id,
        title: ex.title,
        description: ex.description || '',
        questions: (ex.questions || []).length,
        duration: ex.timeLimit || 30,
        passMark: ex.passMark || 50,
        status: ex.published ? 'published' : 'draft',
        mySubmission: myResult ? {
          score: myResult.score,
          total: myResult.total,
          percent: myResult.percent,
          passed: myResult.passed,
          submittedAt: myResult.submittedAt,
        } : null,
      };
    });
    return res.status(200).json({ ok: true, exams });
  }

  // ── Student: get exam questions ───────────────────────────
  if (action === 'get-exam' && req.method === 'POST' && studentId) {
    const student = (data.students || []).find(s => s.portalId === studentId);
    if (!student) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const ex = (data.exams || []).find(e => e.id === body.examId && e.published);
    if (!ex) return res.status(404).json({ error: 'Exam not found or not available' });
    // Check already submitted
    const already = (data.examResults || []).find(r => r.examId === ex.id && r.studentId === student.id);
    if (already) return res.status(400).json({ error: 'You have already submitted this exam.' });
    // Strip correct answers from questions before sending to student
    // True/False questions store no options array — inject them here
    const questions = (ex.questions || []).map(q => {
      const isTF = q.type === 'tf' || q.type === 'truefalse' || q.type === 'true-false' || q.type === 'boolean';
      return {
        id: q.id,
        text: q.text || q.question || '',
        type: 'mcq',
        options: isTF ? ['True', 'False'] : (q.options || []),
      };
    });
    return res.status(200).json({ ok: true, exam: {
      id: ex.id,
      title: ex.title,
      duration: ex.timeLimit || 30,
      passMark: ex.passMark || 50,
      questions,
    }});
  }

  // ── Student: submit exam ──────────────────────────────────
  if (action === 'submit-exam' && req.method === 'POST' && studentId) {
    const student = (data.students || []).find(s => s.portalId === studentId);
    if (!student) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const ex = (data.exams || []).find(e => e.id === body.examId);
    if (!ex) return res.status(404).json({ error: 'Exam not found' });
    if (!data.examResults) data.examResults = [];
    const already = data.examResults.find(r => r.examId === ex.id && r.studentId === student.id);
    if (already) return res.status(400).json({ error: 'Already submitted.' });
    const answers = body.answers || {};
    let score = 0;
    const questionResults = (ex.questions || []).map(q => {
      const given = answers[q.id];
      // Resolve correct answer (same logic as submit-quiz)
      const opts = q.options || [];
      let correctText = q.correctAnswer;
      if (typeof correctText === 'number') correctText = opts[correctText];
      else if (typeof correctText === 'string' && /^[A-Z]$/.test(correctText) && !opts.includes(correctText)) {
        const idx = correctText.charCodeAt(0) - 65;
        if (opts[idx] !== undefined) correctText = opts[idx];
      }
      // True/False: inject options and normalise correct answer
      const isTF = q.type === 'tf' || q.type === 'truefalse' || q.type === 'true-false' || q.type === 'boolean';
      if (isTF && opts.length === 0) opts.push('True', 'False');
      // TF correct stored as 'true'/'false' string — capitalise to match option text
      if (isTF && typeof correctText === 'string' && (correctText === 'true' || correctText === 'false')) {
        correctText = correctText === 'true' ? 'True' : 'False';
      }
      const isMcq = q.type === 'mcq' || isTF || (opts.length > 0);
      let correct = false;
      if (isMcq && given !== undefined && given !== null && given !== '') {
        // given is the index as string; match against option text
        const givenText = opts[parseInt(given)];
        correct = givenText !== undefined && givenText === correctText;
        if (correct) score++;
      }
      // Written answers count as 0 auto-score (teacher grades manually)
      return { questionId: q.id, correct: isMcq ? correct : null, given: given || null, correctAnswer: isMcq ? correctText : null };
    });
    const total = (ex.questions || []).filter(q => q.type === 'mcq' || q.type === 'tf' || q.type === 'truefalse' || q.type === 'true-false' || q.type === 'boolean' || (q.options && q.options.length)).length || (ex.questions || []).length;
    const percent = total > 0 ? Math.round((score / total) * 100) : 0;
    const passed = percent >= (ex.passMark || 50);
    const result = {
      id: 'er_' + Date.now(),
      examId: ex.id,
      examTitle: ex.title,
      studentId: student.id,
      studentName: student.name,
      score, total, percent, passed,
      passMark: ex.passMark || 50,
      questionResults,
      submittedAt: new Date().toISOString(),
    };
    data.examResults.push(result);
    await setData(data);
    return res.status(200).json({ ok: true, score, total, percent, passed, passMark: ex.passMark || 50 });
  }

  // ── Student: my progress (marks + attendance) ─────────────
  if (action === 'my-progress' && req.method === 'GET' && studentId) {
    const student = (data.students || []).find(s => s.portalId === studentId);
    if (!student) return res.status(401).json({ error: 'Unauthorized' });
    // Exam results
    const examResults = (data.examResults || []).filter(r => r.studentId === student.id);
    const scoreSum = examResults.reduce((s, r) => s + (r.percent || 0), 0);
    const overall = examResults.length ? Math.round(scoreSum / examResults.length) : null;
    const results = examResults.map(r => ({
      examTitle: r.examTitle, score: r.score, total: r.total,
      percent: r.percent, passed: r.passed, passMark: r.passMark || 50,
    }));
    // Module attendance
    const c = String(student.course || '');
    const segs = c.split('+').map(x => x.trim());
    const inCourse = (x) => {
      if (c === 'all' || c === 'all3') return true;
      if (c === 'both') return x.course === 'digital' || x.course === 'event';
      return segs.includes(x.course);
    };
    const modules = (data.modules || []).filter(inCourse);
    const allSessions = (data.moduleSessions || []).filter(s => modules.some(m => m.id === s.moduleId));
    const myAtt = (data.moduleAttendance || []).filter(a => a.studentId === student.id);
    const attendance = allSessions.map(s => ({
      title: s.title,
      present: myAtt.some(a => a.sessionId === s.id),
    }));
    const attendedCount = attendance.filter(a => a.present).length;
    const totalSessions = attendance.length;
    const attRate = totalSessions > 0 ? Math.round((attendedCount / totalSessions) * 100) : null;
    return res.status(200).json({ ok: true, results, overall, attendance, attendedCount, totalSessions, attRate });
  }

  // ── Student: messages ─────────────────────────────────────
  if (action === 'messages' && req.method === 'GET' && studentId) {
    const student = (data.students || []).find(s => s.portalId === studentId);
    if (!student) return res.status(401).json({ error: 'Unauthorized' });
    if (!data.studentMessages) data.studentMessages = {};
    const msgs = data.studentMessages[student.id] || [];
    return res.status(200).json({ ok: true, messages: msgs });
  }
  if (action === 'message' && req.method === 'POST' && studentId) {
    const student = (data.students || []).find(s => s.portalId === studentId);
    if (!student) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    if (!body.text?.trim()) return res.status(400).json({ error: 'Message required' });
    if (!data.studentMessages) data.studentMessages = {};
    if (!data.studentMessages[student.id]) data.studentMessages[student.id] = [];
    data.studentMessages[student.id].push({ from: 'student', text: body.text.trim(), at: new Date().toISOString() });
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── Modules & Sessions (new system) ───────────────────────
  // Teacher: list modules + sessions for their course
  if (action === 'modules' && req.method === 'GET') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const t = resolveTeacher(teacherKey, data);
    const modules = (data.modules || []).filter(m => m.course === t.course)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const msessions = (data.moduleSessions || []).filter(s => s.course === t.course);
    const att = (data.moduleAttendance || []).filter(a => msessions.some(s => s.id === a.sessionId));
    return res.status(200).json({ ok: true, modules, sessions: msessions, attendance: att });
  }
  // Teacher: create/update module
  if (action === 'module' && req.method === 'POST') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const t = resolveTeacher(teacherKey, data);
    const body = await parseJSON(req);
    if (!body.title || !body.title.trim()) return res.status(400).json({ error: 'Module title is required' });
    if (!data.modules) data.modules = [];
    if (body.id) {
      const m = data.modules.find(x => x.id === body.id && x.course === t.course);
      if (!m) return res.status(404).json({ error: 'Module not found' });
      m.title = body.title.trim(); m.description = body.description || '';
      await setData(data); return res.status(200).json({ ok: true, module: m });
    }
    const mod = { id: 'mod_' + Date.now(), course: t.course, courseLabel: t.label, title: body.title.trim(), description: body.description || '', order: (data.modules.filter(m => m.course === t.course).length + 1), createdAt: new Date().toISOString() };
    data.modules.push(mod);
    await setData(data); return res.status(201).json({ ok: true, module: mod });
  }
  if (action === 'module' && req.method === 'DELETE') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.query.id;
    data.modules = (data.modules || []).filter(m => m.id !== id);
    const removed = (data.moduleSessions || []).filter(s => s.moduleId === id).map(s => s.id);
    data.moduleSessions = (data.moduleSessions || []).filter(s => s.moduleId !== id);
    data.moduleAttendance = (data.moduleAttendance || []).filter(a => !removed.includes(a.sessionId));
    await setData(data); return res.status(200).json({ ok: true });
  }
  // Teacher: create/update session
  if (action === 'msession' && req.method === 'POST') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const t = resolveTeacher(teacherKey, data);
    const body = await parseJSON(req);
    if (!body.title || !body.title.trim()) return res.status(400).json({ error: 'Session title is required' });
    if (!body.moduleId) return res.status(400).json({ error: 'Module is required' });
    if (!data.moduleSessions) data.moduleSessions = [];
    const fields = {
      moduleId: body.moduleId, title: body.title.trim(), content: body.content || '',
      pdfUrl: body.pdfUrl || '',
      pageStart: parseInt(body.pageStart) || 1,
      pageEnd: parseInt(body.pageEnd) || 0,
      locked: !!body.locked,
    };
    if (body.id) {
      const s = data.moduleSessions.find(x => x.id === body.id && x.course === t.course);
      if (!s) return res.status(404).json({ error: 'Session not found' });
      Object.assign(s, fields);
      await setData(data); return res.status(200).json({ ok: true, session: s });
    }
    const sess = { id: 'msess_' + Date.now(), course: t.course, order: (data.moduleSessions.filter(s => s.moduleId === body.moduleId).length + 1), ...fields, createdAt: new Date().toISOString() };
    data.moduleSessions.push(sess);
    await setData(data); return res.status(201).json({ ok: true, session: sess });
  }
  if (action === 'msession' && req.method === 'DELETE') {
    if (!teacherKeyValid(teacherKey, data)) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.query.id;
    data.moduleSessions = (data.moduleSessions || []).filter(s => s.id !== id);
    data.moduleAttendance = (data.moduleAttendance || []).filter(a => a.sessionId !== id);
    await setData(data); return res.status(200).json({ ok: true });
  }

  // Student: list modules+sessions for their course
  if (action === 'student-modules' && req.method === 'GET' && studentId) {
    const student = (data.students || []).find(s => s.portalId === studentId);
    if (!student) return res.status(401).json({ error: 'Unauthorized' });
    const c = String(student.course || '');
    const segs = c.split('+').map(x => x.trim());
    const clabel = (student.courseLabel || '').toLowerCase().trim();
    const inCourse = (x) => {
      if (c === 'all' || c === 'all3') return true;
      if (c === 'both') return x.course === 'digital' || x.course === 'event';
      if (segs.includes(x.course)) return true;
      const xlabel = (x.courseLabel || '').toLowerCase().trim();
      if (clabel && xlabel && (clabel === xlabel || xlabel.includes(clabel) || clabel.includes(xlabel))) return true;
      return false;
    };
    const modules = (data.modules || []).filter(inCourse).sort((a, b) => (a.order || 0) - (b.order || 0));
    const sessions = (data.moduleSessions || []).filter(s => modules.some(m => m.id === s.moduleId))
      .map(s => ({ id: s.id, moduleId: s.moduleId, title: s.title, locked: !!s.locked, hasPdf: !!s.pdfUrl, hasContent: !!s.content, order: s.order, pageStart: s.pageStart || 1, pageEnd: s.pageEnd || 0 }));
    return res.status(200).json({ ok: true, modules, sessions });
  }
  // Student: open a session -> returns content + auto-marks attendance
  if (action === 'open-session' && req.method === 'POST' && studentId) {
    const student = (data.students || []).find(s => s.portalId === studentId);
    if (!student) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const sess = (data.moduleSessions || []).find(s => s.id === body.sessionId);
    if (!sess) return res.status(404).json({ error: 'Session not found' });
    if (sess.locked) return res.status(403).json({ error: 'This session is locked.' });
    // auto-mark attendance (once per student per session)
    if (!data.moduleAttendance) data.moduleAttendance = [];
    const already = data.moduleAttendance.find(a => a.sessionId === sess.id && a.studentId === student.id);
    if (!already) {
      data.moduleAttendance.push({ id: 'matt_' + Date.now(), sessionId: sess.id, studentId: student.id, studentName: student.name, studentPhone: student.phone || '', markedAt: new Date().toISOString() });
      await setData(data);
    }
    return res.status(200).json({ ok: true, session: { id: sess.id, title: sess.title, content: sess.content || '', pdfUrl: sess.pdfUrl || '', pageStart: sess.pageStart || 1, pageEnd: sess.pageEnd || 0 } });
  }

  // ── Student auth (replaces student-auth.js) ────────────────
  if (req.method === 'POST' && action === 'student-login') {
    const body = await parseJSON(req);
    const { code } = body;
    if (!code) return res.status(400).json({ error: 'Code is required' });
    const normalized = code.trim().toUpperCase();
    const codeObj = data.sessionCodes.find(c => c.code === normalized);
    if (!codeObj) return res.status(404).json({ error: 'Invalid code.' });
    if (!codeObj.active) return res.status(403).json({ error: 'This code has been deactivated.' });
    const session = data.sessions.find(s => s.id === codeObj.sessionId);
    if (!session?.active) return res.status(403).json({ error: 'This session is no longer active.' });
    if (codeObj.usedBy) {
      return res.status(200).json({ ok: true, studentId: codeObj.usedBy, studentCodeId: codeObj.id, studentName: codeObj.studentName, alreadyUsed: true, session: sanitizeSession(session) });
    }
    const sid = 'stu_' + Date.now();
    codeObj.usedBy = sid; codeObj.usedAt = new Date().toISOString();
    await setData(data);
    return res.status(200).json({ ok: true, studentId: sid, studentCodeId: codeObj.id, studentName: codeObj.studentName, studentPhone: codeObj.studentPhone, session: sanitizeSession(session) });
  }

  // ── Student portal login (by portalId) ────────────────────
  if (req.method === 'POST' && action === 'portal-login') {
    const body = await parseJSON(req);
    const { portalId } = body;
    if (!portalId) return res.status(400).json({ error: 'Student ID required' });
    const student = (data.students || []).find(s => s.portalId === portalId.toUpperCase().trim());
    if (!student) return res.status(404).json({ error: 'Student ID not found.' });
    if (!student.portalActive) return res.status(403).json({ error: 'Your access has been deactivated.' });

    const studentSessions = (data.sessions || []).filter(s => studentSeesSession(s, student)).map(s => ({
      id: s.id, title: s.title, sessionNumber: s.sessionNumber, courseLabel: s.courseLabel, course: s.course,
      active: s.active, unlocked: isUnlockedFor(s, student.classType),
      durationMinutes: s.durationMinutes || 45,
      hasQuiz: !!(s.quiz?.questions?.length) && isQuizUnlockedFor(s, student.classType), hasPdf: !!s.pdfUrl,
      pageStart: s.pageStart, pageEnd: s.pageEnd, pdfUrl: s.pdfUrl, description: s.description, materials: s.materials || [],
    }));

    const quizResults = (data.quizResults || []).filter(r => r.studentId === student.id);
    const totalScore = quizResults.reduce((s, r) => s + (r.score||0), 0);
    const totalPossible = quizResults.reduce((s, r) => s + (r.total||0), 0);
    const gradePercent = totalPossible > 0 ? Math.round((totalScore/totalPossible)*100) : null;

    return res.status(200).json({ ok: true, student: { id: student.id, name: student.name, portalId: student.portalId, course: student.course, courseLabel: student.courseLabel, classType: student.classType||'in-person', batchId: student.batchId||null, batchName: student.batchName||null }, sessions: studentSessions, quizResults, gradePercent });
  }

  // ── Public: timer state ───────────────────────────────────
  if (req.method === 'GET' && action === 'timer') {
    const session = data.sessions.find(s => s.id === req.query.sessionId);
    if (!session) return res.status(404).json({ error: 'Not found' });
    let timer = session.timer || { paused: true, secondsLeft: (session.durationMinutes||45)*60, lastUpdated: null };
    if (!timer.paused && timer.lastUpdated) timer = { ...timer, secondsLeft: Math.max(0, timer.secondsLeft - Math.floor((Date.now()-timer.lastUpdated)/1000)) };
    return res.status(200).json({ ok: true, timer, sessionActive: session.active });
  }

  // ── Public: QR token ──────────────────────────────────────
  if (req.method === 'GET' && action === 'qr-token') {
    const session = data.sessions.find(s => s.id === req.query.sessionId);
    if (!session) return res.status(404).json({ error: 'Not found' });
    const token = generateQRToken(req.query.sessionId, QR_SECRET);
    return res.status(200).json({ ok: true, token, sessionId: req.query.sessionId, expiresIn: 30 - (Math.floor(Date.now()/1000)%30) });
  }

  // ── Public: classroom state ───────────────────────────────
  if (req.method === 'GET' && action === 'classroom') {
    const room = data.classrooms[req.query.sessionId] || { active: false, roomName: null };
    const hands = data.handRaises[req.query.sessionId] || [];
    return res.status(200).json({ ok: true, room, hands });
  }

  // ── Student: session content ──────────────────────────────
  if (req.method === 'GET' && action === 'session-content' && studentId) {
    const student = (data.students||[]).find(s => s.portalId === studentId);
    if (!student) return res.status(401).json({ error: 'Unauthorized' });
    const session = data.sessions.find(s => s.id === req.query.sessionId);
    if (!session) return res.status(404).json({ error: 'Not found' });
    if (!isUnlockedFor(session, student.classType)) return res.status(403).json({ error: 'Session not yet unlocked.' });
    const noteKey = `${student.id}_${req.query.sessionId}`;
    return res.status(200).json({
      ok: true,
      session: {
        ...sanitizeSession(session),
        quiz: (session.quiz && isQuizUnlockedFor(session, student.classType)) ? { id: session.quiz.id, title: session.quiz.title, timeLimit: session.quiz.timeLimit||30, questionCount: session.quiz.questions?.length||0, questions: session.quiz.questions.map(q => ({ id: q.id, type: q.type, question: q.question, options: q.options })) } : null,
      },
      notes: data.studentNotes[noteKey] || '',
      highlights: data.highlights[noteKey] || [],
    });
  }

  // ── Attend via QR ─────────────────────────────────────────
  if (req.method === 'POST' && action === 'attend') {
    const body = await parseJSON(req);
    const { token, sessionId, studentCodeId } = body;
    const current = generateQRToken(sessionId, QR_SECRET);
    const prev = crypto.createHmac('sha256', QR_SECRET+sessionId).update(String(Math.floor(Date.now()/30000)-1)).digest('hex').substring(0,12);
    if (token !== current && token !== prev) return res.status(403).json({ error: 'QR code expired.' });
    const code = data.sessionCodes.find(c => c.id === studentCodeId && c.sessionId === sessionId);
    if (!code) return res.status(404).json({ error: 'Student not found' });
    const already = data.attendance.find(a => a.studentCodeId === studentCodeId && a.sessionId === sessionId);
    if (already) return res.status(200).json({ ok: true, alreadyMarked: true, studentName: code.studentName });
    data.attendance.push({ id: 'att_'+Date.now(), sessionId, studentCodeId, studentName: code.studentName||'Unknown', studentPhone: code.studentPhone||'', markedAt: new Date().toISOString() });
    await setData(data);
    return res.status(200).json({ ok: true, studentName: code.studentName });
  }

  // ── Verify teacher ────────────────────────────────────────
  let teacher = null;
  if (teacherKey) {
    teacher = resolveTeacher(teacherKey, data);
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
  } else if (action !== 'portal-login' && action !== 'student-login' && action !== 'save-notes' && action !== 'save-highlights' && action !== 'submit-quiz' && action !== 'ask-teacher' && !studentId) {
    if (adminKey !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── GET: sessions, codes, attendance ─────────────────────
  if (req.method === 'GET' && !action) {
    let sessions = data.sessions, codes = data.sessionCodes, attendance = data.attendance;
    let quizResults = data.quizResults || [];
    if (teacher) {
      sessions = sessions.filter(s => s.course === teacher.course);
      codes = codes.filter(c => c.course === teacher.course);
      const sIds = new Set(sessions.map(s => s.id));
      attendance = attendance.filter(a => sIds.has(a.sessionId));
      quizResults = quizResults.filter(r => sIds.has(r.sessionId));
    }
    return res.status(200).json({ ok: true, sessions, codes, attendance, quizResults });
  }

  // ── POST: create session ──────────────────────────────────
  if (req.method === 'POST' && action === 'create-session') {
    const body = await parseJSON(req);
    const { title, description, materials, sessionNumber, durationMinutes } = body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const course = teacher?.course || body.course;
    const t = resolveTeacher(course, data);
    const duration = parseInt(durationMinutes)||45;
    const batchId = body.batchId || null;
    const batch = batchId ? (data.batches||[]).find(b => b.id === batchId) : null;
    const session = { id: 's_'+Date.now(), course, courseLabel: t?.label||course, batchId, batchName: batch?.name || null, sessionNumber: sessionNumber||(data.sessions.filter(s=>s.course===course).length+1), title, description: description||'', materials: materials||[], durationMinutes: duration, timer: { paused: true, secondsLeft: duration*60, lastUpdated: null }, createdAt: new Date().toISOString(), active: true };
    data.sessions.push(session);
    await setData(data);
    return res.status(201).json({ ok: true, session });
  }

  // ── POST: upload course PDF ───────────────────────────────
  if (req.method === 'POST' && action === 'upload-course') {
    const { fileBuffer, fileName, duration, teacherKey: tk, modulesText, batchId } = await parseMultipart(req);
    const t = resolveTeacher(tk, data);
    if (!t) return res.status(401).json({ error: 'Unauthorized' });
    const moduleLines = (modulesText||'').split('\n').map(l=>l.trim()).filter(Boolean);
    if (!moduleLines.length) return res.status(400).json({ error: 'No module titles provided' });
    let pdfUrl = null;
    if (fileBuffer?.length > 100) {
      try { const blob = await put(`courses/${tk}/${Date.now()}_${fileName}`, fileBuffer, { access: 'public', contentType: 'application/pdf' }); pdfUrl = blob.url; } catch(e) {}
    }
    const bId = batchId || null;
    const batch = bId ? (data.batches||[]).find(b => b.id === bId) : null;
    const existingCount = data.sessions.filter(s => s.course === t.course).length;
    const newSessions = moduleLines.map((title, i) => ({ id: 's_'+Date.now()+'_'+i, course: t.course, courseLabel: t.label, batchId: bId, batchName: batch?.name || null, sessionNumber: existingCount+i+1, title, description: `Module ${i+1} — ${t.label} course.`, materials: pdfUrl?[`Course PDF: ${pdfUrl}`]:[], durationMinutes: parseInt(duration)||45, timer: { paused: true, secondsLeft: (parseInt(duration)||45)*60, lastUpdated: null }, createdAt: new Date().toISOString(), active: true, fromPDF: !!pdfUrl, pdfUrl }));
    data.sessions = [...data.sessions, ...newSessions];
    await setData(data);
    return res.status(200).json({ ok: true, sessionsCreated: newSessions.length, sessions: newSessions, pdfUrl });
  }

  // ── POST: generate codes ──────────────────────────────────
  if (req.method === 'POST' && action === 'generate-codes') {
    const body = await parseJSON(req);
    const { sessionId, count, students: studs } = body;
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const existingCodes = new Set(data.sessionCodes.map(c => c.code));
    const newCodes = [];
    const items = studs?.length ? studs : Array.from({ length: Math.min(parseInt(count)||1, 100) }, () => ({}));
    items.forEach((item, i) => {
      let code; do { code = generateCode(); } while (existingCodes.has(code)); existingCodes.add(code);
      newCodes.push({ id: 'c_'+Date.now()+'_'+i, code, sessionId, course: session.course, studentId: item.id||null, studentName: item.name||null, studentPhone: item.phone||null, usedBy: null, usedAt: null, active: true, createdAt: new Date().toISOString() });
    });
    data.sessionCodes = [...data.sessionCodes, ...newCodes];
    await setData(data);
    return res.status(201).json({ ok: true, codes: newCodes });
  }

  // ── POST: classroom start/stop ────────────────────────────
  if (req.method === 'POST' && action === 'classroom-start') {
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const roomName = `GDA-${body.sessionId.replace(/[^a-zA-Z0-9]/g,'')}`.substring(0,50);
    data.classrooms[body.sessionId] = { active: true, roomName, startedAt: new Date().toISOString(), course: teacher.course, title: body.sessionTitle||'Class' };
    data.handRaises[body.sessionId] = [];
    await setData(data);
    return res.status(200).json({ ok: true, roomName });
  }

  if (req.method === 'POST' && action === 'classroom-stop') {
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    if (data.classrooms[body.sessionId]) data.classrooms[body.sessionId].active = false;
    data.handRaises[body.sessionId] = [];
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── POST: quiz save ───────────────────────────────────────
  if (req.method === 'POST' && action === 'save-quiz') {
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const session = data.sessions.find(s => s.id === body.sessionId);
    if (!session || session.course !== teacher.course) return res.status(404).json({ error: 'Not found' });
    const prevLock = session.quiz?.unlockedFor || { online: false, inperson: false };
    session.quiz = { id: session.quiz?.id || 'quiz_'+Date.now(), title: body.title||`${session.title} — Quiz`, questions: body.questions, timeLimit: parseInt(body.timeLimit)||30, unlockedFor: prevLock, createdAt: session.quiz?.createdAt || new Date().toISOString() };
    await setData(data);
    return res.status(200).json({ ok: true, quiz: session.quiz });
  }

  // ── POST: submit quiz (student) ───────────────────────────
  if (req.method === 'POST' && action === 'submit-quiz' && studentId) {
    const student = (data.students||[]).find(s => s.portalId === studentId);
    if (!student) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const { sessionId, answers, quit } = body;
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session?.quiz) return res.status(404).json({ error: 'Quiz not found' });
    if (!isQuizUnlockedFor(session, student.classType)) return res.status(403).json({ error: 'This quiz is locked.' });
    const existing = data.quizResults.find(r => r.studentId === student.id && r.sessionId === sessionId);
    if (existing) return res.status(400).json({ error: 'Already submitted.' });
    let score = 0;
    const results = session.quiz.questions.map(q => {
      const selected = quit ? null : answers[q.id];
      // Resolve correctAnswer to option TEXT, tolerating legacy formats:
      // - text (new): "Paris"
      // - letter (old MC): "A"/"B"/"C"/"D"
      // - index (numeric): 0/1/2/3
      const opts = q.options || ['True', 'False'];
      let correctText = q.correctAnswer;
      if (typeof correctText === 'number') {
        correctText = opts[correctText];
      } else if (typeof correctText === 'string' && /^[A-Z]$/.test(correctText) && !opts.includes(correctText)) {
        const idx = correctText.charCodeAt(0) - 65;
        if (opts[idx] !== undefined) correctText = opts[idx];
      }
      const correct = !quit && selected != null && selected === correctText;
      if (correct) score++;
      return { questionId: q.id, correct, selected, correctAnswer: correctText };
    });
    const result = { id: 'qr_'+Date.now(), studentId: student.id, studentName: student.name, sessionId, sessionTitle: session.title, score, total: session.quiz.questions.length, percent: quit?0:Math.round((score/session.quiz.questions.length)*100), quit: !!quit, results, submittedAt: new Date().toISOString() };
    data.quizResults.push(result);
    await setData(data);
    return res.status(200).json({ ok: true, score, total: result.total, percent: result.percent, results });
  }

  // ── DELETE: quiz result (teacher) ─────────────────────────
  if (req.method === 'DELETE' && action === 'delete-quiz-result') {
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const { resultId } = body;
    if (!resultId) return res.status(400).json({ error: 'resultId required' });
    const before = data.quizResults.length;
    data.quizResults = data.quizResults.filter(r => r.id !== resultId);
    if (data.quizResults.length === before) return res.status(404).json({ error: 'Result not found' });
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── PATCH: edit quiz result score (teacher) ───────────────
  if (req.method === 'PATCH' && action === 'edit-quiz-result') {
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const { resultId, score } = body;
    if (!resultId || score === undefined) return res.status(400).json({ error: 'resultId and score required' });
    const result = data.quizResults.find(r => r.id === resultId);
    if (!result) return res.status(404).json({ error: 'Result not found' });
    const newScore = Math.max(0, Math.min(result.total, parseInt(score)));
    result.score = newScore;
    result.percent = result.total > 0 ? Math.round((newScore/result.total)*100) : 0;
    result.editedAt = new Date().toISOString();
    result.editedBy = teacher.label;
    await setData(data);
    return res.status(200).json({ ok: true, score: result.score, percent: result.percent });
  }

  // ── POST: ask teacher (student) ───────────────────────────
  if (req.method === 'POST' && action === 'ask-teacher' && studentId) {
    const student = (data.students||[]).find(s => s.portalId === studentId);
    if (!student) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    if (!body.question?.trim()) return res.status(400).json({ error: 'Question required' });
    data.studentQuestions.push({ id: 'q_'+Date.now(), studentId: student.id, studentName: student.name, sessionId: body.sessionId||null, question: body.question.trim(), answered: false, answer: null, askedAt: new Date().toISOString() });
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── PATCH: timer control ──────────────────────────────────
  if (req.method === 'PATCH' && action === 'timer') {
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const session = data.sessions.find(s => s.id === body.sessionId);
    if (!session || session.course !== teacher.course) return res.status(404).json({ error: 'Not found' });
    if (!session.timer) session.timer = { paused: true, secondsLeft: (session.durationMinutes||45)*60, lastUpdated: null };
    const now = Date.now();
    if (!session.timer.paused && session.timer.lastUpdated) session.timer.secondsLeft = Math.max(0, session.timer.secondsLeft - Math.floor((now-session.timer.lastUpdated)/1000));
    session.timer.lastUpdated = now;
    if (body.command === 'pause') session.timer.paused = true;
    if (body.command === 'resume') session.timer.paused = false;
    if (body.command === 'reset') { session.timer.paused = true; session.timer.secondsLeft = (session.durationMinutes||45)*60; }
    if (body.addMinutes) session.timer.secondsLeft = Math.max(0, session.timer.secondsLeft + (parseInt(body.addMinutes)*60));
    await setData(data);
    return res.status(200).json({ ok: true, timer: session.timer });
  }

  // ── PATCH: unlock session (per class type) ────────────────
  if (req.method === 'PATCH' && action === 'unlock-session') {
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const session = data.sessions.find(s => s.id === body.sessionId && s.course === teacher.course);
    if (!session) return res.status(404).json({ error: 'Not found' });
    // Migrate legacy flag into the new per-class-type structure on first touch
    if (!session.unlockedFor) {
      session.unlockedFor = {
        online: !!session.unlockedForStudents,
        inperson: !!session.unlockedForStudents,
      };
    }
    const ct = normalizeClassType(body.classType);
    session.unlockedFor[ct] = !session.unlockedFor[ct];
    // Keep legacy field in sync (true if unlocked for anyone) for old clients
    session.unlockedForStudents = session.unlockedFor.online || session.unlockedFor.inperson;
    await setData(data);
    return res.status(200).json({ ok: true, unlockedFor: session.unlockedFor });
  }

  // ── PATCH: lock/unlock quiz (per class type) ──────────────
  if (req.method === 'PATCH' && action === 'unlock-quiz') {
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const session = data.sessions.find(s => s.id === body.sessionId && s.course === teacher.course);
    if (!session) return res.status(404).json({ error: 'Not found' });
    if (!session.quiz) return res.status(404).json({ error: 'This session has no quiz.' });
    if (!session.quiz.unlockedFor) session.quiz.unlockedFor = { online: false, inperson: false };
    const ct = normalizeClassType(body.classType);
    session.quiz.unlockedFor[ct] = !session.quiz.unlockedFor[ct];
    await setData(data);
    return res.status(200).json({ ok: true, unlockedFor: session.quiz.unlockedFor });
  }
  // ── PATCH: set page range ─────────────────────────────────
  if (req.method === 'PATCH' && action === 'set-pages') {
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    const session = data.sessions.find(s => s.id === body.sessionId && s.course === teacher.course);
    if (!session) return res.status(404).json({ error: 'Not found' });
    session.pageStart = parseInt(body.pageStart); session.pageEnd = parseInt(body.pageEnd);
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── PATCH: deactivate codes ───────────────────────────────
  if (req.method === 'PATCH' && action === 'deactivate-codes') {
    const body = await parseJSON(req);
    data.sessionCodes = data.sessionCodes.map(c => {
      if (body.sessionId && c.sessionId === body.sessionId) return { ...c, active: false };
      if (body.codeIds?.includes(c.id)) return { ...c, active: false };
      return c;
    });
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── PATCH: toggle session active ──────────────────────────
  if (req.method === 'PATCH' && action === 'toggle-session') {
    const body = await parseJSON(req);
    const session = data.sessions.find(s => s.id === body.sessionId);
    if (!session) return res.status(404).json({ error: 'Not found' });
    session.active = !session.active;
    await setData(data);
    return res.status(200).json({ ok: true, active: session.active });
  }

  // ── PATCH: hand raise ─────────────────────────────────────
  if (req.method === 'PATCH' && action === 'raise-hand') {
    const body = await parseJSON(req);
    const { sessionId, studentName, studentCodeId, action: act } = body;
    if (!data.handRaises[sessionId]) data.handRaises[sessionId] = [];
    if (act === 'raise') {
      if (!data.handRaises[sessionId].find(h => h.studentCodeId === studentCodeId))
        data.handRaises[sessionId].push({ studentCodeId, studentName, raisedAt: new Date().toISOString() });
    } else {
      data.handRaises[sessionId] = data.handRaises[sessionId].filter(h => h.studentCodeId !== studentCodeId);
    }
    await setData(data);
    return res.status(200).json({ ok: true, hands: data.handRaises[sessionId] });
  }

  // ── PATCH: lower hand (teacher) ───────────────────────────
  if (req.method === 'PATCH' && action === 'lower-hand') {
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    if (data.handRaises[body.sessionId]) data.handRaises[body.sessionId] = data.handRaises[body.sessionId].filter(h => h.studentCodeId !== body.studentCodeId);
    await setData(data);
    return res.status(200).json({ ok: true, hands: data.handRaises[body.sessionId]||[] });
  }

  // ── PATCH: save notes (student) ───────────────────────────
  if (req.method === 'PATCH' && action === 'save-notes' && studentId) {
    const student = (data.students||[]).find(s => s.portalId === studentId);
    if (!student) return res.status(401).json({ error: 'Unauthorized' });
    const body = await parseJSON(req);
    data.studentNotes[`${student.id}_${body.sessionId}`] = body.notes;
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── DELETE: session(s) ────────────────────────────────────
  if (req.method === 'DELETE' && !action) {
    const body = await parseJSON(req);
    // Support both single sessionId and array of sessionIds
    const ids = body.sessionIds
      ? body.sessionIds
      : (body.sessionId ? [body.sessionId] : []);
    if (!ids.length) return res.status(400).json({ error: 'No sessionId(s) provided' });
    const idSet = new Set(ids);
    data.sessions = data.sessions.filter(s => !idSet.has(s.id));
    data.sessionCodes = data.sessionCodes.filter(c => !idSet.has(c.sessionId));
    data.attendance = data.attendance.filter(a => !idSet.has(a.sessionId));
    if (data.quizResults) data.quizResults = data.quizResults.filter(r => !idSet.has(r.sessionId));
    await setData(data);
    return res.status(200).json({ ok: true, deleted: ids.length });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function sanitizeSession(s) {
  return { id: s.id, title: s.title, sessionNumber: s.sessionNumber, courseLabel: s.courseLabel, description: s.description, materials: s.materials, pdfUrl: s.pdfUrl, pageStart: s.pageStart, pageEnd: s.pageEnd, durationMinutes: s.durationMinutes||45 };
}

// ── Class-type aware unlock ─────────────────────────────────
// New format: session.unlockedFor = { online: bool, inperson: bool }
// Legacy fallback: session.unlockedForStudents (single global flag)
function normalizeClassType(ct) {
  return (ct === 'online') ? 'online' : 'inperson';
}

function isUnlockedFor(session, classType) {
  if (session.unlockedFor) return !!session.unlockedFor[normalizeClassType(classType)];
  return !!session.unlockedForStudents; // legacy sessions keep working
}

// Quiz has its own independent per-class-type lock. Locked by default:
// if a quiz has no unlockedFor set, it is NOT visible to students.
function isQuizUnlockedFor(session, classType) {
  const q = session.quiz;
  if (!q) return false;
  if (!q.unlockedFor) return false; // default locked
  return !!q.unlockedFor[normalizeClassType(classType)];
}

function teacherKeyValid(key, data) {
  return !!resolveTeacher(key, data);
}

function matchesCourse(sessionCourse, studentCourse) {
  if (!studentCourse) return false;
  if (studentCourse === 'all3' || studentCourse === 'all') return true;
  // Legacy value from the original 2-course system: Digital Marketing + Event Organizing
  if (studentCourse === 'both') return sessionCourse === 'digital' || sessionCourse === 'event';
  if (studentCourse.includes('+')) return studentCourse.split('+').includes(sessionCourse);
  return sessionCourse === studentCourse;
}

// A student sees a session when the course matches AND (batch rules permit).
// Batch rules are backward-compatible:
//  - If the session has no batchId, everyone matching the course sees it (legacy).
//  - If the session HAS a batchId, only students in that batch see it.
//  - A student with no batchId only sees batch-less (legacy) sessions.
function studentSeesSession(session, student) {
  if (!matchesCourse(session.course, student.course)) return false;
  if (!session.batchId) return true;              // legacy/global session
  return student.batchId === session.batchId;     // batched session
}
