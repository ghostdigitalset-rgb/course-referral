import { get } from '@vercel/blob';
import { Readable } from 'node:stream';
import { getData } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Student ID required' });

  const data = await getData();
  const student = data.students.find(s => s.id === id);
  if (!student || !student.proofPathname) {
    return res.status(404).json({ error: 'No proof of payment on file' });
  }

  try {
    const result = await get(student.proofPathname, { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return res.status(404).json({ error: 'Proof file not found' });
    }
    res.setHeader('Content-Type', result.blob.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    Readable.fromWeb(result.stream).pipe(res);
  } catch (e) {
    console.error('proof fetch error:', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'Could not load proof image' });
  }
}

