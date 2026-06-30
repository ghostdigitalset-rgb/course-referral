import { put } from '@vercel/blob';
import { getData, setData } from './_store.js';

export const config = {
  api: { bodyParser: false }
};

const MAX_BYTES = 4 * 1024 * 1024; // 4MB (Vercel server functions cap request bodies at 4.5MB)

const TEACHER_CREDENTIALS = {
  'digital': { password: process.env.TEACHER_DIGITAL_PASS || 'TeacherDM2026', course: 'digital', label: 'Digital Marketing' },
  'event':   { password: process.env.TEACHER_EVENT_PASS   || 'TeacherEV2026', course: 'event',   label: 'Event Organizing' },
  'ai':      { password: process.env.TEACHER_AI_PASS      || 'TeacherAI2026', course: 'ai',      label: 'Applied AI' },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error('TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

// Minimal multipart/form-data parser — no external deps.
// Returns { fields: {name: value}, files: {name: {filename, contentType, buffer}} }
function parseMultipart(buffer, boundary) {
  const fields = {};
  const files = {};
  const boundaryBuf = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(boundaryBuf);
  if (start === -1) return { fields, files };

  while (start !== -1) {
    const partStart = start + boundaryBuf.length;
    // Check for terminal boundary "--boundary--"
    if (buffer[partStart] === 0x2d && buffer[partStart + 1] === 0x2d) break;

    const nextBoundary = buffer.indexOf(boundaryBuf, partStart);
    if (nextBoundary === -1) break;

    // Part content is between partStart (+CRLF) and nextBoundary (-CRLF)
    let partBuf = buffer.slice(partStart, nextBoundary);
    // Trim leading CRLF
    if (partBuf[0] === 0x0d && partBuf[1] === 0x0a) partBuf = partBuf.slice(2);
    // Trim trailing CRLF before next boundary
    if (partBuf[partBuf.length - 2] === 0x0d && partBuf[partBuf.length - 1] === 0x0a) {
      partBuf = partBuf.slice(0, partBuf.length - 2);
    }

    const headerEnd = partBuf.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = partBuf.slice(0, headerEnd).toString('utf8');
      const body = partBuf.slice(headerEnd + 4);

      const nameMatch = headerText.match(/name="([^"]+)"/);
      const filenameMatch = headerText.match(/filename="([^"]*)"/);
      const typeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);

      const name = nameMatch ? nameMatch[1] : null;
      if (name) {
        if (filenameMatch && filenameMatch[1]) {
          files[name] = {
            filename: filenameMatch[1],
            contentType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
            buffer: body
          };
        } else {
          fields[name] = body.toString('utf8');
        }
      }
    }

    start = nextBoundary;
  }

  return { fields, files };
}

function generateCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-teacher-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) {
    return res.status(400).json({ error: 'Expected multipart/form-data request' });
  }
  const boundary = boundaryMatch[1].replace(/^"|"$/g, '');

  let buffer;
  try {
    buffer = await readBody(req);
  } catch (e) {
    if (e.message === 'TOO_LARGE') {
      return res.status(400).json({ error: 'File too large. Max size is 4MB' });
    }
    console.error('upload-course read error:', e);
    return res.status(400).json({ error: 'Could not read the uploaded file. Please try again' });
  }

  const { fields, files } = parseMultipart(buffer, boundary);

  // ── Auth ────────────────────────────────────────────────
  const teacherKey = fields.teacherKey;
  const teacher = TEACHER_CREDENTIALS[teacherKey];
  if (!teacher) return res.status(401).json({ error: 'Unauthorized' });

  // ── Validate inputs ─────────────────────────────────────
  const duration = parseInt(fields.duration) || 45;
  const moduleLines = (fields.modules || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!moduleLines.length) return res.status(400).json({ error: 'No module titles provided' });

  // ── Upload PDF to Blob (optional) ────────────────────────
  let pdfUrl = null;
  const pdfFile = files.pdf;
  if (pdfFile && pdfFile.buffer && pdfFile.buffer.length) {
    if (pdfFile.contentType !== 'application/pdf' && !/\.pdf$/i.test(pdfFile.filename)) {
      return res.status(400).json({ error: 'Please upload a PDF file' });
    }
    try {
      const safeName = `course-pdf/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
      const blob = await put(safeName, pdfFile.buffer, {
        access: 'public',
        contentType: 'application/pdf',
        addRandomSuffix: false
      });
      pdfUrl = blob.url;
    } catch (e) {
      console.error('upload-course blob put error:', e && e.message ? e.message : e);
      return res.status(500).json({ error: 'PDF upload failed: ' + (e && e.message ? e.message : 'unknown error') });
    }
  }

  // ── Create sessions ───────────────────────────────────────
  try {
    const data = await getData();
    if (!data.sessions) data.sessions = [];

    const existingCount = data.sessions.filter(s => s.course === teacher.course).length;
    const newSessions = [];

    moduleLines.forEach((title, i) => {
      const session = {
        id: 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        course: teacher.course,
        title,
        description: `Module ${existingCount + i + 1} — ${teacher.label} course.`,
        sessionNumber: existingCount + i + 1,
        durationMinutes: duration,
        materials: pdfUrl ? [{ type: 'pdf', url: pdfUrl, name: 'Course Material' }] : [],
        active: false,
        timer: { paused: true, secondsLeft: duration * 60, lastUpdated: null },
        createdAt: new Date().toISOString()
      };
      data.sessions.push(session);
      newSessions.push(session);
    });

    await setData(data);

    return res.status(200).json({
      ok: true,
      sessionsCreated: newSessions.length,
      sessions: newSessions,
      pdfUrl
    });
  } catch (e) {
    console.error('upload-course session create error:', e);
    return res.status(500).json({ error: 'Failed to create sessions: ' + (e && e.message ? e.message : 'unknown error') });
  }
}
