import { put } from '@vercel/blob';

export const config = {
  api: { bodyParser: false }
};

const MAX_BYTES = 4 * 1024 * 1024; // 4MB (Vercel server functions cap request bodies at 4.5MB)
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-filename');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('upload error: BLOB_READ_WRITE_TOKEN is not set');
    return res.status(500).json({ error: 'File storage is not configured yet. Please contact the site admin.' });
  }

  const contentType = (req.headers['content-type'] || '').split(';')[0].trim();
  if (!ALLOWED_TYPES.includes(contentType)) {
    return res.status(400).json({ error: 'Please upload a JPG, PNG, WEBP, or HEIC image (got: ' + (contentType || 'unknown') + ')' });
  }

  let buffer;
  try {
    buffer = await readBody(req);
  } catch (e) {
    if (e.message === 'TOO_LARGE') {
      return res.status(400).json({ error: 'File too large. Max size is 4MB' });
    }
    console.error('upload read error:', e);
    return res.status(400).json({ error: 'Could not read the uploaded file. Please try again' });
  }

  if (!buffer || !buffer.length) {
    return res.status(400).json({ error: 'No file received' });
  }

  try {
    const ext = contentType.split('/')[1] || 'jpg';
    const filename = `payment-proof/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const blob = await put(filename, buffer, {
      access: 'private',
      contentType,
      addRandomSuffix: false
    });

    return res.status(200).json({ ok: true, url: blob.url, pathname: blob.pathname });
  } catch (e) {
    console.error('blob put error:', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'Upload failed: ' + (e && e.message ? e.message : 'unknown error') });
  }
}

