import { put } from '@vercel/blob';

export const config = {
  api: { bodyParser: false }
};

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-filename');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const contentType = req.headers['content-type'] || '';
  if (!ALLOWED_TYPES.includes(contentType)) {
    return res.status(400).json({ error: 'Please upload a JPG, PNG, WEBP, or HEIC image' });
  }

  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BYTES) {
        return res.status(400).json({ error: 'File too large. Max size is 5MB' });
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) return res.status(400).json({ error: 'No file received' });

    const ext = contentType.split('/')[1] || 'jpg';
    const filename = `payment-proof/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const blob = await put(filename, buffer, {
      access: 'public',
      contentType
    });

    return res.status(200).json({ ok: true, url: blob.url });
  } catch (e) {
    console.error('upload error:', e);
    return res.status(500).json({ error: 'Upload failed. Please try again' });
  }
}
