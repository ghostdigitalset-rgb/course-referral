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

      // Split by boundary
      const boundaryBuf = Buffer.from('--' + boundary);
      let pos = 0;

      while (pos < buffer.length) {
        const boundaryPos = buffer.indexOf(boundaryBuf, pos);
        if (boundaryPos === -1) break;
        pos = boundaryPos + boundaryBuf.length;

        // Skip \r\n after boundary
        if (buffer[pos] === 0x0d && buffer[pos+1] === 0x0a) pos += 2;
        else if (buffer[pos] === 0x0a) pos += 1;

        // Check for end boundary
        if (buffer[pos] === 0x2d && buffer[pos+1] === 0x2d) break;

        // Find end of headers
        const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), pos);
        if (headerEnd === -1) break;

        const headerStr = buffer.slice(pos, headerEnd).toString('utf8');
        pos = headerEnd + 4;

        // Find next boundary
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
        }
        pos = nextBoundary === -1 ? buffer.length : nextBoundary;
      }
      resolve({ fileBuffer, fileName, duration, teacherKey });
    });
    req.on('error', reject);
  });
}

// Pure JS PDF text extractor — reads PDF streams
function extractTextFromPDF(buffer) {
  const raw = buffer.toString('latin1');
  const texts = [];

  // Method 1: Extract from PDF text operators (BT...ET blocks)
  const btEtRegex = /BT([\s\S]{1,2000}?)ET/g;
  let m;
  while ((m = btEtRegex.exec(raw)) !== null) {
    const block = m[1];
    // Match strings in () used with Tj, TJ, ', "
    const strRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|'|")/g;
    let sm;
    while ((sm = strRegex.exec(block)) !== null) {
      const str = sm[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (str.trim().length > 1) texts.push(str.trim());
    }
    // Also match TJ arrays
    const tjRegex = /\[([^\]]+)\]\s*TJ/g;
    let tj;
    while ((tj = tjRegex.exec(block)) !== null) {
      const parts = tj[1].match(/\(([^)]*)\)/g) || [];
      const combined = parts.map(p => p.slice(1,-1)).join('');
      if (combined.trim().length > 1) texts.push(combined.trim());
    }
  }

  // Method 2: Look for raw text between stream markers
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  while ((m = streamRegex.exec(raw)) !== null) {
    const stream = m[1];
    // Only process uncompressed streams (no FlateDecode)
    if (!stream.includes('FlateDecode')) {
      const strRegex2 = /\(([^)]{2,80})\)\s*Tj/g;
      let sm2;
      while ((sm2 = strRegex2.exec(stream)) !== null) {
        if (sm2[1].trim()) texts.push(sm2[1].trim());
      }
    }
  }

  return texts.join(' ');
}

// Parse modules from text
function parseModules(text) {
  const modules = [];
  const seen = new Set();

  // Pattern 1: "MODULE 0 Introduction..." or "MODULE 0\nTitle"
  const patterns = [
    /MODULE\s+(\d+)\s+([A-Z][A-Za-z &()\/,\-]{3,70})/g,
    /MODULE\s+(\d+)[:\-\s]+([A-Za-z][A-Za-z &()\/,\-]{3,70})/gi,
    /Module\s+(\d+)[:\-\.\s]+([A-Za-z][A-Za-z &()\/,\-]{3,70})/g,
    /CHAPTER\s+(\d+)[:\-\.\s]+([A-Za-z][A-Za-z &()\/,\-]{3,70})/gi,
    /SESSION\s+(\d+)[:\-\.\s]+([A-Za-z][A-Za-z &()\/,\-]{3,70})/gi,
    /UNIT\s+(\d+)[:\-\.\s]+([A-Za-z][A-Za-z &()\/,\-]{3,70})/gi,
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const num = parseInt(m[1]);
      const title = m[2].trim().replace(/\s+/g, ' ').replace(/[^\w\s&()\/,\-]/g, '').trim();
      if (title.length > 3 && !seen.has(title)) {
        seen.add(title);
        modules.push({ number: num, title });
      }
    }
    if (modules.length > 0) break;
  }

  return modules.sort((a, b) => a.number - b.number);
}

// Fallback: extract topics from bullet-like lines if no MODULE headings found
function extractTopicsAsFallback(text) {
  const lines = text.split(/[\n•\-\*]+/).map(l => l.trim()).filter(l => l.length > 5 && l.length < 80);
  const topics = [];
  const seen = new Set();
  let num = 1;
  for (const line of lines) {
    if (/^[A-Z]/.test(line) && !seen.has(line) && !/^(Ghost|Digital Marketing|Course|Page|Introduction)/.test(line)) {
      seen.add(line);
      topics.push({ number: num++, title: line });
      if (topics.length >= 15) break;
    }
  }
  return topics;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-teacher-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fileBuffer, fileName, duration, teacherKey } = await parseMultipart(req);

    const teacher = TEACHER_CREDENTIALS[teacherKey];
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });
    if (!fileBuffer || fileBuffer.length < 100) return res.status(400).json({ error: 'No PDF file received' });

    // Upload to Vercel Blob
    let pdfUrl = null;
    try {
      const blob = await put(`courses/${teacherKey}/${Date.now()}_${fileName}`, fileBuffer, {
        access: 'public', contentType: 'application/pdf',
      });
      pdfUrl = blob.url;
    } catch(e) { console.log('Blob upload skipped:', e.message); }

    // Extract text and parse modules
    const text = extractTextFromPDF(fileBuffer);
    let modules = parseModules(text);

    // If no modules detected, try fallback
    if (modules.length === 0) {
      modules = extractTopicsAsFallback(text);
    }

    if (modules.length === 0) {
      return res.status(422).json({
        error: 'No modules detected. Make sure your PDF has "MODULE X Title" headings.',
        debug: text.substring(0, 300)
      });
    }

    // Create sessions
    const data = await getData();
    if (!data.sessions) data.sessions = [];
    const existingCount = data.sessions.filter(s => s.course === teacher.course).length;
    const newSessions = modules.map((mod, i) => ({
      id:            's_' + Date.now() + '_' + i,
      course:        teacher.course,
      courseLabel:   teacher.label,
      sessionNumber: existingCount + i + 1,
      title:         mod.title,
      description:   `Module ${mod.number} — ${teacher.label} course.`,
      materials:     pdfUrl ? [`Course PDF: ${pdfUrl}`] : [],
      durationMinutes: parseInt(duration) || 45,
      timer:         { paused: true, secondsLeft: (parseInt(duration)||45) * 60, lastUpdated: null },
      createdAt:     new Date().toISOString(),
      active:        true,
      fromPDF:       true,
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
