import { getData, setData } from './_store.js';

const FEES = { digital: 10000, event: 8000, both: 15000 };
const LABELS = { digital: 'Digital Marketing', event: 'Event Organizing', both: 'Both courses' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, phone, email, course, notes, ref } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'Phone is required' });
  if (!course || !FEES[course]) return res.status(400).json({ error: 'Invalid course' });

  const data = await getData();

  const student = {
    id: 's_' + Date.now(),
    name: name.trim(),
    phone: phone.trim(),
    email: (email || '').trim(),
    notes: (notes || '').trim(),
    course,
    courseLabel: LABELS[course],
    fee: FEES[course],
    ref: ref || '',
    date: new Date().toLocaleDateString('en-GB'),
    createdAt: new Date().toISOString()
  };

  data.students.push(student);

  // Increment rep signup count
  if (ref) {
    const rep = data.reps.find(r => r.id === ref);
    if (rep) {
      rep.signups = (rep.signups || 0) + 1;
    }
  }

  await setData(data);
  return res.status(201).json({ ok: true, studentId: student.id });
}
