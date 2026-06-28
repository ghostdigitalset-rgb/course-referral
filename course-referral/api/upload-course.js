import { getData, setData } from './_store.js';
import { put } from '@vercel/blob';

const TEACHER_CREDENTIALS = {
  'digital': { password: process.env.TEACHER_DIGITAL_PASS || 'TeacherDM2026', course: 'digital', label: 'Digital Marketing' },
  'event':   { password: process.env.TEACHER_EVENT_PASS   || 'TeacherEV2026', course: 'event',   label: 'Event Organizing' },
  'ai':      { password: process.env.TEACHER_AI_PASS      || 'TeacherAI2026', course: 'ai',      label: 'Applied AI' },
};

export const config = { api: { bodyParser: false } };

async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)$/);
      if (!boundaryMatch) return reject(new Error('No boundary found'));
      const boundary = boundaryMatch[1].trim();

      let fileBuffer = null;
      let fileName = 'course.pdf';
      let duration = 45;
      let teacherKey = '';
      let modulesText = '';

      const boundaryBuf = Buffer.from('--' + boundary);
      let pos = 0;

      while (pos < buffer.length) {
        const boundaryPos = buffer.indexOf(boundaryBuf, pos);
        if (boundaryPos === -1) break;
        pos = boundaryPos + boundaryBuf.length;
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

        if (fileNameMatch && fieldName === 'pdf') {
          fileName = fileNameMatch[1];
          fileBuffer = body;
        } else if (fieldName === 'duration') {
          duration = parseInt(body.toString('utf8').trim()) || 45;
        } else if (fieldName === 'teacherKey') {
          teacherKey = body.toString('utf8').trim();
        } else if (fieldName === 'modules') {
          modulesText = body.toString('utf8').trim();
        }
        pos = nextBoundary === -1 ? buffer.length : nextBoundary;
      }
      resolve({ fileBuffer, fileName, duration, teacherKey, modulesText });
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-teacher-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fileBuffer, fileName, duration, teacherKey, modulesText } = await parseMultipart(req);

    const teacher = TEACHER_CREDENTIALS[teacherKey];
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });

    // Parse module titles from text
    const moduleLines = (modulesText || '').split('\n').map(l => l.trim()).filter(Boolean);
    if (!moduleLines.length) return res.status(400).json({ error: 'No module titles provided' });

    // Upload PDF to Vercel Blob if provided
    let pdfUrl = null;
    if (fileBuffer && fileBuffer.length > 100) {
      try {
        const blob = await put(`courses/${teacherKey}/${Date.now()}_${fileName}`, fileBuffer, {
          access: 'public', contentType: 'application/pdf',
        });
        pdfUrl = blob.url;
      } catch(e) { console.log('Blob upload skipped:', e.message); }
    }

    // Create sessions
    const data = await getData();
    if (!data.sessions) data.sessions = [];
    const existingCount = data.sessions.filter(s => s.course === teacher.course).length;

    const newSessions = moduleLines.map((title, i) => ({
      id:            's_' + Date.now() + '_' + i,
      course:        teacher.course,
      courseLabel:   teacher.label,
      sessionNumber: existingCount + i + 1,
      title,
      description:   `Module ${i + 1} — ${teacher.label} course.`,
      materials:     pdfUrl ? [`Course PDF: ${pdfUrl}`] : [],
      durationMinutes: parseInt(duration) || 45,
      timer:         { paused: true, secondsLeft: (parseInt(duration)||45) * 60, lastUpdated: null },
      createdAt:     new Date().toISOString(),
      active:        true,
      fromPDF:       !!pdfUrl,
      pdfUrl,
    }));

    data.sessions = [...data.sessions, ...newSessions];
    await setData(data);

    return res.status(200).json({ ok: true, sessionsCreated: newSessions.length, sessions: newSessions, pdfUrl });

  } catch(e) {
    console.error('Upload error:', e);
    return res.status(500).json({ error: e.message || 'Upload failed' });
  }
}
