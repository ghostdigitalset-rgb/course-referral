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

function ensureDefaults(data) {
  if (!data.settings) data.settings = {};
  if (!Array.isArray(data.settings.courses)) data.settings.courses = DEFAULT_COURSES;
  if (typeof data.settings.bundleDiscount !== 'number') data.settings.bundleDiscount = 10; // percent off when ALL courses selected
  if (typeof data.settings.discountPercent !== 'number') data.settings.discountPercent = 0; // sitewide discount, 0 = off
  if (!('discountStart' in data.settings)) data.settings.discountStart = null; // 'YYYY-MM-DD'
  if (!('discountEnd' in data.settings)) data.settings.discountEnd = null;     // 'YYYY-MM-DD'
  if (typeof data.settings.badgeText !== 'string') data.settings.badgeText = ''; // offer banner text, empty = hidden
  if (!Array.isArray(data.settings.roundHistory)) data.settings.roundHistory = [];
  if (!data.settings.currentRound) {
    // Migrate from the old single-round settings. The round that is active now keeps the
    // default id, so students saved before rounds existed stay counted in it.
    const legacyLabel = typeof data.settings.roundLabel === 'string' ? data.settings.roundLabel.trim() : '';
    data.settings.currentRound = {
      id: DEFAULT_ROUND_ID,
      label: legacyLabel || '2nd round',
      open: data.settings.registrationOpen !== false,
      seats: { 'in-person': 0, online: 0 },
      createdAt: new Date().toISOString()
    };
  }
  delete data.settings.roundLabel;
  delete data.settings.registrationOpen;
  if (!data.settings.telebirr) data.settings.telebirr = { number: '', holder: 'Ghost Digitals Academy' };
  if (!data.settings.cbe) data.settings.cbe = { number: '', holder: 'Ghost Digitals Academy' };
  return data;
}

// What students see about the current round: name, open state, seats total and seats left.
function publicRound(round, students) {
  const inP = seatInfo(students, round, 'in-person');
  const onl = seatInfo(students, round, 'online');
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    // Public: registration page needs account numbers, course list and round info
    let data = await getData();
    data = ensureDefaults(data);
    await setData(data);
    // Hidden courses and round history are left out for public visitors.
    const { roundHistory, ...rest } = data.settings;
    const students = data.students || [];
    return res.status(200).json({
      ...rest,
      courses: data.settings.courses.filter(c => !c.hidden),
      currentRound: publicRound(data.settings.currentRound, students)
    });
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
        cleaned.push({
          id: c.id && String(c.id).trim() ? String(c.id).trim() : 'c_' + Date.now() + '_' + cleaned.length,
          name,
          price: Math.round(price),
          description: (c.description || '').trim(),
          duration: (c.duration || '').trim(),
          icon: (c.icon || '📚').trim() || '📚',
          hidden: c.hidden === true
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

    // ── Update the current round (name, open/closed, seats) ────
    if (action === 'round') {
      applyRoundFields(data.settings.currentRound, req.body);
      await setData(data);
      return res.status(200).json({ ok: true, settings: data.settings });
    }

    // ── Start a new round: closes the current one and starts fresh seats ────
    if (action === 'new-round') {
      const prev = data.settings.currentRound;
      prev.open = false;
      prev.endedAt = new Date().toISOString();
      data.settings.roundHistory.push(prev);

      const next = {
        id: newRoundId(),
        label: 'New round',
        open: true,
        seats: { 'in-person': 0, online: 0 },
        createdAt: new Date().toISOString()
      };
      applyRoundFields(next, req.body);
      data.settings.currentRound = next;
      await setData(data);
      return res.status(200).json({ ok: true, settings: data.settings });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
