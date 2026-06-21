import { getData, setData } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Student ID required' });

  const data = await getData();

  if (req.method === 'DELETE') {
    const student = data.students.find(s => s.id === id);
    if (student && student.ref) {
      const rep = data.reps.find(r => r.id === student.ref);
      if (rep && rep.signups > 0) rep.signups--;
    }
    data.students = data.students.filter(s => s.id !== id);
    await setData(data);
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'PATCH') {
    const student = data.students.find(s => s.id === id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { status } = req.query;

    if (status === 'verified' || status === 'rejected') {
      student.paymentStatus = status;
      student.paid = status === 'verified';
      await setData(data);
      return res.status(200).json({ ok: true, paymentStatus: student.paymentStatus, paid: student.paid });
    }

    // Legacy/manual toggle (no status param)
    student.paid = !student.paid;
    await setData(data);
    return res.status(200).json({ ok: true, paid: student.paid });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
