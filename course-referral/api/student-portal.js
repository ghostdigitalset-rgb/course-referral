import { getData, setData } from './_store.js';

function generateStudentId() {
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

  const data = await getData();
  if (!data.students) data.students = [];
  if (!data.sessions) data.sessions = [];
  if (!data.studentNotes) data.studentNotes = {};
  if (!data.studentQuestions) data.studentQuestions = [];
  if (!data.quizResults) data.quizResults = [];
  if (!data.highlights) data.highlights = {};

  // ── Generate student ID (admin) ───────────────────────────
  if (req.method === 'POST' && req.query.action === 'generate-id') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    const { studentId: sid } = req.body;
    const student = data.students.find(s => s.id === sid);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Generate unique portal ID
    let portalId;
    const existingIds = new Set(data.students.map(s => s.portalId).filter(Boolean));
    do { portalId = generateStudentId(); } while (existingIds.has(portalId));

    student.portalId    = portalId;
    student.classType   = req.body.classType || 'in-person';
    student.portalActive = true;
    await setData(data);
    return res.status(200).json({ ok: true, portalId });
  }

  // ── Student login ─────────────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'login') {
    const { portalId } = req.body;
    if (!portalId) return res.status(400).json({ error: 'Student ID required' });

    const student = data.students.find(s => s.portalId === portalId.toUpperCase().trim());
    if (!student) return res.status(404).json({ error: 'Student ID not found. Please check your ID and try again.' });
    if (!student.portalActive) return res.status(403).json({ error: 'Your portal access has been deactivated. Contact your teacher.' });

    // Get their sessions based on course
    const studentCourse = student.course;
    const sessions = (data.sessions || [])
      .filter(s => {
        if (studentCourse === 'all3' || studentCourse === 'both') return true;
        if (studentCourse.includes('+')) return studentCourse.split('+').some(c => s.course === c);
        return s.course === studentCourse;
      })
      .map(s => ({
        id: s.id,
        title: s.title,
        sessionNumber: s.sessionNumber,
        courseLabel: s.courseLabel,
        active: s.active,
        unlocked: s.unlockedForStudents || false,
        durationMinutes: s.durationMinutes || 45,
        hasQuiz: !!(s.quiz && s.quiz.questions?.length),
        hasPdf: !!(s.pdfUrl),
        pageStart: s.pageStart || null,
        pageEnd: s.pageEnd || null,
        pdfUrl: s.pdfUrl || null,
        description: s.description || '',
        materials: s.materials || [],
      }));

    // Get quiz results for this student
    const quizResults = (data.quizResults || []).filter(r => r.studentId === student.id);

    // Calculate total grade
    const totalScore = quizResults.reduce((sum, r) => sum + (r.score || 0), 0);
    const totalPossible = quizResults.reduce((sum, r) => sum + (r.total || 0), 0);
    const gradePercent = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : null;

    return res.status(200).json({
      ok: true,
      student: {
        id:         student.id,
        name:       student.name,
        portalId:   student.portalId,
        course:     student.course,
        courseLabel:student.courseLabel,
        classType:  student.classType || 'in-person',
      },
      sessions,
      quizResults,
      gradePercent,
    });
  }

  // Verify student for subsequent requests
  const studentPortalId = req.headers['x-student-id'];
  let currentStudent = null;
  if (studentPortalId) {
    currentStudent = data.students.find(s => s.portalId === studentPortalId);
    if (!currentStudent) return res.status(401).json({ error: 'Invalid student ID' });
  }

  // ── GET: session content (guidebook pages) ────────────────
  if (req.method === 'GET' && req.query.action === 'session-content') {
    const { sessionId } = req.query;
    if (!currentStudent) return res.status(401).json({ error: 'Unauthorized' });
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.unlockedForStudents) return res.status(403).json({ error: 'This session is not yet unlocked.' });

    // Get student notes and highlights
    const noteKey = `${currentStudent.id}_${sessionId}`;
    const notes = data.studentNotes[noteKey] || '';
    const highlights = data.highlights[noteKey] || [];

    return res.status(200).json({
      ok: true,
      session: {
        id: session.id,
        title: session.title,
        sessionNumber: session.sessionNumber,
        description: session.description,
        materials: session.materials,
        pdfUrl: session.pdfUrl,
        pageStart: session.pageStart,
        pageEnd: session.pageEnd,
        quiz: session.quiz ? {
          id: session.quiz.id,
          title: session.quiz.title,
          timeLimit: session.quiz.timeLimit || 30,
          questions: session.quiz.questions.map(q => ({
            id: q.id,
            type: q.type,
            question: q.question,
            options: q.options,
            // correctAnswer NOT sent to student
          })),
          questionCount: session.quiz.questions?.length || 0,
        } : null,
      },
      notes,
      highlights,
    });
  }

  // ── PATCH: save notes ─────────────────────────────────────
  if (req.method === 'PATCH' && req.query.action === 'save-notes') {
    if (!currentStudent) return res.status(401).json({ error: 'Unauthorized' });
    const { sessionId, notes } = req.body;
    const noteKey = `${currentStudent.id}_${sessionId}`;
    data.studentNotes[noteKey] = notes;
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── PATCH: save highlights ────────────────────────────────
  if (req.method === 'PATCH' && req.query.action === 'save-highlights') {
    if (!currentStudent) return res.status(401).json({ error: 'Unauthorized' });
    const { sessionId, highlights } = req.body;
    const noteKey = `${currentStudent.id}_${sessionId}`;
    data.highlights[noteKey] = highlights;
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── POST: submit quiz ─────────────────────────────────────
  if (req.method === 'POST' && req.query.action === 'submit-quiz') {
    if (!currentStudent) return res.status(401).json({ error: 'Unauthorized' });
    const { sessionId, answers, quit } = req.body;
    const session = data.sessions.find(s => s.id === sessionId);
    if (!session?.quiz) return res.status(404).json({ error: 'Quiz not found' });

    const existing = (data.quizResults || []).find(r => r.studentId === currentStudent.id && r.sessionId === sessionId);
    if (existing) return res.status(400).json({ error: 'You have already submitted this quiz.' });

    let score = 0;
    const results = [];

    if (quit) {
      score = 0;
      session.quiz.questions.forEach(q => results.push({ questionId: q.id, correct: false, selected: null }));
    } else {
      session.quiz.questions.forEach(q => {
        const selected = answers[q.id];
        const correct = selected === q.correctAnswer;
        if (correct) score++;
        results.push({ questionId: q.id, correct, selected, correctAnswer: q.correctAnswer });
      });
    }

    const result = {
      id:         'qr_' + Date.now(),
      studentId:  currentStudent.id,
      studentName:currentStudent.name,
      sessionId,
      sessionTitle: session.title,
      score,
      total:      session.quiz.questions.length,
      percent:    Math.round((score / session.quiz.questions.length) * 100),
      quit:       !!quit,
      results,
      submittedAt: new Date().toISOString(),
    };

    if (!data.quizResults) data.quizResults = [];
    data.quizResults.push(result);
    await setData(data);
    return res.status(200).json({ ok: true, score, total: result.total, percent: result.percent, results });
  }

  // ── POST: submit question for teacher ─────────────────────
  if (req.method === 'POST' && req.query.action === 'ask-teacher') {
    if (!currentStudent) return res.status(401).json({ error: 'Unauthorized' });
    const { sessionId, question } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: 'Question is required' });

    if (!data.studentQuestions) data.studentQuestions = [];
    data.studentQuestions.push({
      id:          'q_' + Date.now(),
      studentId:   currentStudent.id,
      studentName: currentStudent.name,
      sessionId,
      question:    question.trim(),
      answered:    false,
      answer:      null,
      askedAt:     new Date().toISOString(),
    });
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  // ── ADMIN: get all questions ──────────────────────────────
  if (req.method === 'GET' && req.query.action === 'questions') {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    return res.status(200).json({ ok: true, questions: data.studentQuestions || [] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
