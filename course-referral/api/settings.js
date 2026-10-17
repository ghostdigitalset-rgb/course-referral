import { getData, setData } from './_store.js';
import { verifyAdmin } from './_auth.js';
import { seatInfo, DEFAULT_ROUND_ID } from './_seats.js';

// Default courses (used only if none saved yet — preserves your original 3)
const DEFAULT_COURSES = [
  { id: 'digital', name: 'Digital Marketing', price: 10000, description: 'Social media, SEO, ads & more', duration: '', icon: '📣' },
  { id: 'event',   name: 'Event Organizing',  price: 8000,  description: 'Planning, logistics & execution', duration: '', icon: '🎪' },
  { id: 'ai',      name: 'Applied AI: Tools, Techniques, and Real-World Use Cases', price: 10000, description: 'AI tools, prompt engineering & practical applications', duration: '', icon: '🤖' }
];

const cleanSeats = (v) => Math.max(0, Math.round(Number(v) || 0));

function newRoundId() {
  return 'r' + Date.now().toString(36);
}

function makeRound(id, label, open, seats) {
  return {
    id,
    label: label || '2nd round',
    open: open !== false,
    seats: { 'in-person': cleanSeats(seats?.['in-person']), online: cleanSeats(seats?.online) },
    createdAt: new Date().toISOString()
  };
}

function ensureDefaults(data) {
  if (!data.settings) data.settings = {};
  if (!Array.isArray(data.settings.courses)) data.settings.courses = DEFAULT_COURSES;
  if (typeof data.settings.bundleDiscount !== 'number') data.settings.bundleDiscount = 10; // percent off when ALL courses selected
  if (typeof data.settings.discountPercent !== 'number') data.settings.discountPercent = 0; // sitewide discount, 0 = off
  if (!('discountStart' in data.settings)) data.settings.discountStart = null; // 'YYYY-MM-DD'
  if (!('discountEnd' in data.settings)) data.settings.discountEnd = null;     // 'YYYY-MM-DD'
  if (typeof data.settings.badgeText !== 'string') data.settings.badgeText = ''; // offer banner text, empty = hidden

  // Migrate: the single site-wide round from the previous version becomes each course's
  // round, keeping its id so existing students stay counted in it.
  const legacy = data.settings.currentRound;
  for (const c of data.settings.courses) {
    if (!c.round) {
      c.round = legacy
        ? makeRound(legacy.id || DEFAULT_ROUND_ID, legacy.label, legacy.open, legacy.seats)
        : makeRound(DEFAULT_ROUND_ID, typeof data.settings.roundLabel === 'string' && data.settings.roundLabel.trim() ? data.settings.roundLabel.trim() : '2nd round', data.settings.registrationOpen !== false, null);
    }
    if (!Array.isArray(c.roundHistory)) c.roundHistory = [];
  }
  delete data.settings.currentRound;
  delete data.settings.roundHistory;
  delete data.settings.roundLabel;
  delete data.settings.registrationOpen;

  if (!data.settings.telebirr) data.settings.telebirr = { number: '', holder: 'Ghost Digitals Academy' };
  if (!data.settings.cbe) data.settings.cbe = { number: '', holder: 'Ghost Digitals Academy' };
  return data;
}

// What students see about a course's round: name, open state, seats total and seats left.
function publicRound(course, students) {
  const round = course.round || {};
  const inP = seatInfo(students, course, 'in-person');
  const onl = seatInfo(students, course, 'online');
  return {
    id: round.id,
    label: round.label,
    open: round.open !== false,
    seats: { 'in-person': inP.total, online: onl.total },
    seatsLeft: { 'in-person': inP.left, online: onl.left }
  };
}

function applyRoundFields(round, body) {
  if (typeof body.label === 'string' && body.label.trim()) round.label = body.label.trim().slice(0, 40);
  if (typeof body.open === 'boolean') round.open = body.open;
  if (body.seats && typeof body.seats === 'object') {
    round.seats = { 'in-person': cleanSeats(body.seats['in-person']), online: cleanSeats(body.seats.online) };
  }
}

function findCourse(data, courseId) {
  return data.settings.courses.find((c) => String(c.id) === String(courseId));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    // Public: registration page needs account numbers, course list and each course's round
    let data = await getData();
    data = ensureDefaults(data);
    await setData(data);
    const students = data.students || [];
    const courses = data.settings.courses
      .filter(c => !c.hidden)
      .map(({ round, roundHistory, ...c }) => ({ ...c, round: publicRound({ ...c, round }, students) }));
    const { roundHistory, ...rest } = data.settings;
    return res.status(200).json({ ...rest, courses });
  }

  if (req.method === 'POST') {
    // Admin only
    let data = await getData();
    data = ensureDefaults(data);
    const adminKey = req.headers['x-admin-key'];
    if (!verifyAdmin(adminKey, data).ok) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const action = req.body?.action || 'payment';

    // ── Save payment (bank) settings ──────────────────────────
    if (action === 'payment') {
      const { telebirr, cbe } = req.body;
      if (!telebirr || !telebirr.number || !telebirr.number.trim()) {
        return res.status(400).json({ error: 'Telebirr number is required' });
      }
      if (!cbe || !cbe.number || !cbe.number.trim()) {
        return res.status(400).json({ error: 'CBE account number is required' });
      }
      data.settings.telebirr = {
        number: telebirr.number.trim(),
        holder: (telebirr.holder || '').trim() || 'Ghost Digitals Academy'
      };
      data.settings.cbe = {
        number: cbe.number.trim(),
        holder: (cbe.holder || '').trim() || 'Ghost Digitals Academy'
      };
      await setData(data);
      return res.status(200).json({ ok: true, settings: data.settings });
    }

    // ── Save courses + bundle discount + sitewide discount + offer badge ────
    if (action === 'courses') {
      const { courses, bundleDiscount, discountPercent, discountStart, discountEnd } = req.body;
      if (!Array.isArray(courses)) {
        return res.status(400).json({ error: 'Courses must be a list' });
      }
      const cleaned = [];
      for (const c of courses) {
        const name = (c.name || '').trim();
        const price = Number(c.price);
        if (!name) return res.status(400).json({ error: 'Every course needs a name' });
        if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: `Invalid price for "${name}"` });
        const id = c.id && String(c.id).trim() ? String(c.id).trim() : 'c_' + Date.now() + '_' + cleaned.length;
        // Keep the course's round and its history. The round is changed only from its own controls.
        const existing = findCourse(data, id);
        cleaned.push({
          id,
          name,
          price: Math.round(price),
          description: (c.description || '').trim(),
          duration: (c.duration || '').trim(),
          icon: (c.icon || '📚').trim() || '📚',
          hidden: c.hidden === true,
          round: existing?.round || makeRound(DEFAULT_ROUND_ID, '2nd round', true, null),
          roundHistory: existing?.roundHistory || []
        });
      }
      let disc = Number(bundleDiscount);
      if (!Number.isFinite(disc) || disc < 0) disc = 0;
      if (disc > 90) disc = 90; // safety cap

      let sitewideDisc = Number(discountPercent);
      if (!Number.isFinite(sitewideDisc) || sitewideDisc < 0) sitewideDisc = 0;
      if (sitewideDisc > 90) sitewideDisc = 90; // safety cap

      const dateRe = /^\d{4}-\d{2}-\d{2}$/;
      const cleanStart = typeof discountStart === 'string' && dateRe.test(discountStart) ? discountStart : null;
      const cleanEnd = typeof discountEnd === 'string' && dateRe.test(discountEnd) ? discountEnd : null;

      data.settings.courses = cleaned;
      data.settings.bundleDiscount = Math.round(disc);
      data.settings.discountPercent = Math.round(sitewideDisc);
      data.settings.discountStart = cleanStart;
      data.settings.discountEnd = cleanEnd;
      if (typeof req.body.badgeText === 'string') data.settings.badgeText = req.body.badgeText.trim().slice(0, 80);
      await setData(data);
      return res.status(200).json({ ok: true, settings: data.settings });
    }

    // ── Update one course's round (name, open/closed, seats) ────
    if (action === 'course-round') {
      const course = findCourse(data, req.body.courseId);
      if (!course) return res.status(404).json({ error: 'Course not found. Save courses first.' });
      applyRoundFields(course.round, req.body);
      await setData(data);
      return res.status(200).json({ ok: true, settings: data.settings });
    }

    // ── Start a new round for one course: closes the current one, seats start empty ────
    if (action === 'course-new-round') {
      const course = findCourse(data, req.body.courseId);
      if (!course) return res.status(404).json({ error: 'Course not found. Save courses first.' });
      const prev = course.round;
      course.roundHistory = course.roundHistory || [];
      course.roundHistory.push({ ...prev, open: false, endedAt: new Date().toISOString() });
      const next = makeRound(newRoundId(), 'New round', true, null);
      applyRoundFields(next, req.body);
      course.round = next;
      await setData(data);
      return res.status(200).json({ ok: true, settings: data.settings });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
