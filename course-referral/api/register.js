import { getData, setData } from './_store.js';

const BASE_FEES = { digital: 10000, event: 8000, ai: 10000 };
const BASE_LABELS = { digital: 'Digital Marketing', event: 'Event Organizing', ai: 'Applied AI' };
const BUNDLE_PRICE = 25000;
const PAYMENT_METHODS = { telebirr: 'Telebirr', cbe: 'CBE', cash: 'Cash' };

function generatePortalId(existingIds = new Set()) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = 'GDA-';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  } while (existingIds.has(id));
  return id;
}

function resolveCourse(course, courseLabel, fee) {
  // All 3 bundle shortcut
  if (course === 'all3' || course === 'both') {
    return {
      courseKey: 'all3',
      courseLabel: courseLabel || 'All 3 courses',
      fee: fee != null ? fee : BUNDLE_PRICE
    };
  }

  // Single known course
  if (BASE_FEES[course] != null) {
    return {
      courseKey: course,
      courseLabel: courseLabel || BASE_LABELS[course],
      fee: fee != null ? fee : BASE_FEES[course]
    };
  }

  // Combo like "digital+event" or "digital+ai" etc.
  if (course && course.includes('+')) {
    const parts = course.split('+').filter(p => BASE_FEES[p] != null);
    if (parts.length < 2) return null;
    const all3 = ['digital', 'event', 'ai'].every(k => parts.includes(k));
    const computedFee = all3 ? BUNDLE_PRICE : parts.reduce((s, k) => s + BASE_FEES[k], 0);
    const computedLabel = all3 ? 'All 3 courses' : parts.map(k => BASE_LABELS[k]).join(' + ');
    return {
      courseKey: all3 ? 'all3' : course,
      courseLabel: courseLabel || computedLabel,
      fee: fee != null ? fee : computedFee
    };
  }

  return null; // truly invalid
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    name, phone, email, course, courseLabel, fee,
    notes, ref, paymentMethod, paymentStatus,
    proofUrl, proofPathname, manualEntry, classType
  } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'Phone is required' });

  const resolved = resolveCourse(course, courseLabel, fee);
  if (!resolved) return res.status(400).json({ error: 'Invalid course selection' });

  if (!paymentMethod || !PAYMENT_METHODS[paymentMethod]) {
    return res.status(400).json({ error: 'Please select a payment method' });
  }

  // Proof is required for public registrations but not manual admin entries
  if (!manualEntry && (!proofPathname || !proofPathname.trim())) {
    return res.status(400).json({ error: 'Please attach your proof of payment' });
  }

  const data = await getData();

  // Generate unique portal ID for student
  const existingPortalIds = new Set(data.students.map(s => s.portalId).filter(Boolean));
  const portalId = generatePortalId(existingPortalIds);

  const isVerified = manualEntry
    ? (paymentStatus === 'verified')
    : false;

  const student = {
    id: 's_' + Date.now(),
    name: name.trim(),
    phone: phone.trim(),
    email: (email || '').trim(),
    notes: (notes || '').trim(),
    course: resolved.courseKey,
    courseLabel: resolved.courseLabel,
    fee: resolved.fee,
    ref: ref || '',
    paymentMethod,
    paymentMethodLabel: PAYMENT_METHODS[paymentMethod],
    proofUrl: (proofUrl || '').trim(),
    proofPathname: (proofPathname || '').trim(),
    paymentStatus: isVerified ? 'verified' : 'pending',
    paid: isVerified,
    manualEntry: !!manualEntry,
    classType: classType || 'in-person',
    portalId,
    portalActive: true,
    date: new Date().toLocaleDateString('en-GB'),
    createdAt: new Date().toISOString()
  };

  data.students.push(student);

  // Increment rep signup count
  if (ref) {
    const rep = data.reps.find(r => r.id === ref);
    if (rep) rep.signups = (rep.signups || 0) + 1;
  }

  await setData(data);
  return res.status(201).json({ ok: true, studentId: student.id, ...student });
}
