import { getData } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Rep ID required' });

  const data = await getData();
  const rep = data.reps.find(r => r.id === id);

  if (!rep) return res.status(404).json({ error: 'Sales rep not found. Check your code.' });

  // Get students this rep referred
  const myStudents = data.students.filter(s => s.ref === id);

  // Course breakdown
  const breakdown = { digital: 0, event: 0, both: 0 };
  myStudents.forEach(s => { breakdown[s.course] = (breakdown[s.course] || 0) + 1; });

  const totalRevenue = myStudents.reduce((sum, s) => sum + s.fee, 0);

  return res.status(200).json({
    rep: { id: rep.id, name: rep.name, phone: rep.phone },
    signups: myStudents.length,
    revenue: totalRevenue,
    breakdown,
    students: myStudents.map(s => ({
      name: s.name,
      course: s.courseLabel,
      fee: s.fee,
      date: s.date
    }))
  });
}
