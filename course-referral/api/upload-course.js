import { getData, setData } from './_store.js';
import { put } from '@vercel/blob';

const TEACHER_CREDENTIALS = {
  'digital': { password: process.env.TEACHER_DIGITAL_PASS || 'TeacherDM2026', course: 'digital', label: 'Digital Marketing' },
  'event':   { password: process.env.TEACHER_EVENT_PASS   || 'TeacherEV2026', course: 'event',   label: 'Event Organizing' },
  'ai':      { password: process.env.TEACHER_AI_PASS      || 'TeacherAI2026', course: 'ai',      label: 'Applied AI' },
};

export const config = { api: { bodyParser: false } };

// Parse multipart form data manually
async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const boundary = req.headers['content-type']?.split('boundary=')[1];
      if (!boundary) return reject(new Error('No boundary found'));

      const parts = buffer.toString('binary').split('--' + boundary);
      let fileBuffer = null;
      let fileName = 'course.pdf';
      let duration = 45;
      let teacherKey = '';

      for (const part of parts) {
        if (part.includes('Content-Disposition')) {
          const nameMatch = part.match(/name="([^"]+)"/);
          const fileNameMatch = part.match(/filename="([^"]+)"/);
          const fieldName = nameMatch?.[1];

          // Split header and body
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          const body = part.slice(headerEnd + 4, part.lastIndexOf('\r\n'));

          if (fileNameMatch && fieldName === 'pdf') {
            fileName = fileNameMatch[1];
            fileBuffer = Buffer.from(body, 'binary');
          } else if (fieldName === 'duration') {
            duration = parseInt(body.trim()) || 45;
          } else if (fieldName === 'teacherKey') {
            teacherKey = body.trim();
          }
        }
      }

      resolve({ fileBuffer, fileName, duration, teacherKey });
    });
    req.on('error', reject);
  });
}

// Extract text from PDF buffer using basic binary parsing
function extractPDFText(buffer) {
  const text = buffer.toString('latin1');
  const textMatches = [];

  // Extract text between BT and ET markers (PDF text blocks)
  const btEtRegex = /BT([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(text)) !== null) {
    const block = match[1];
    // Extract strings from Tj, TJ, and ' operators
    const strRegex = /\(([^)]*)\)\s*(?:Tj|'|")|(\[(?:[^\]]*\([^)]*\)[^\]]*)*\])\s*TJ/g;
    let strMatch;
    while ((strMatch = strRegex.exec(block)) !== null) {
      const str = strMatch[1] || '';
      if (str.trim()) textMatches.push(str.trim());
    }
  }

  return textMatches.join(' ');
}

// Parse modules from extracted text
function parseModules(text) {
  const modules = [];

  // Try MODULE X pattern
  const moduleRegex = /MODULE\s+(\d+)\s+([A-Za-z][^\n]{3,60})/gi;
  let match;
  while ((match = moduleRegex.exec(text)) !== null) {
    const num = parseInt(match[1]);
    const title = match[2].trim().replace(/\s+/g, ' ');
    if (title.length > 3 && title.length < 80) {
      modules.push({ number: num, title });
    }
  }

  // Also try "Module X:" pattern
  if (modules.length === 0) {
    const altRegex = /(?:Module|CHAPTER|UNIT|TOPIC|SESSION)\s*(\d+)[:\-\.\s]+([A-Za-z][^\n]{3,60})/gi;
    while ((match = altRegex.exec(text)) !== null) {
      const num = parseInt(match[1]);
      const title = match[2].trim().replace(/\s+/g, ' ');
      if (title.length > 3 && title.length < 80) {
        modules.push({ number: num, title });
      }
    }
  }

  // Deduplicate
  const seen = new Set();
  return modules.filter(m => {
    const key = `${m.number}-${m.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.number - b.number);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-teacher-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fileBuffer, fileName, duration, teacherKey } = await parseMultipart(req);

    // Verify teacher
    const teacher = TEACHER_CREDENTIALS[teacherKey];
    if (!teacher) return res.status(401).json({ error: 'Unauthorized' });

    if (!fileBuffer || fileBuffer.length < 100) {
      return res.status(400).json({ error: 'No PDF file received' });
    }

    // Upload PDF to Vercel Blob for storage
    let pdfUrl = null;
    try {
      const blob = await put(`courses/${teacherKey}/${Date.now()}_${fileName}`, fileBuffer, {
        access: 'public',
        contentType: 'application/pdf',
      });
      pdfUrl = blob.url;
    } catch(e) {
      console.log('Blob upload failed, continuing without URL:', e.message);
    }

    // Extract text and parse modules
    const text = extractPDFText(fileBuffer);
    const modules = parseModules(text);

    if (modules.length === 0) {
      return res.status(422).json({
        error: 'No modules detected in this PDF. Make sure your PDF has "MODULE X: Title" headings.',
        textSample: text.substring(0, 500)
      });
    }

    // Create sessions from modules
    const data = await getData();
    if (!data.sessions) data.sessions = [];

    const newSessions = [];
    const existingCount = data.sessions.filter(s => s.course === teacher.course).length;

    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const session = {
        id:            's_' + Date.now() + '_' + i,
        course:        teacher.course,
        courseLabel:   teacher.label,
        sessionNumber: existingCount + i + 1,
        title:         mod.title,
        description:   `Module ${mod.number} of the ${teacher.label} course.`,
        materials:     pdfUrl ? [`Course PDF: ${pdfUrl}`] : [],
        durationMinutes: duration,
        timer:         { paused: true, secondsLeft: duration * 60, lastUpdated: null },
        createdAt:     new Date().toISOString(),
        active:        true,
        fromPDF:       true,
        pdfUrl,
      };
      newSessions.push(session);
    }

    data.sessions = [...data.sessions, ...newSessions];
    await setData(data);

    return res.status(200).json({
      ok: true,
      sessionsCreated: newSessions.length,
      sessions: newSessions,
      pdfUrl,
    });

  } catch(e) {
    console.error('Upload error:', e);
    return res.status(500).json({ error: e.message || 'Upload failed' });
  }
}
