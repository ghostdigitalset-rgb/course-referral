import { getData, setData } from './_store.js';
import { verifyAdmin } from './_auth.js';

const BASE_FEES = { digital: 10000, event: 8000, ai: 10000 };
const BASE_LABELS = { digital: 'Digital Marketing', event: 'Event Organizing', ai: 'Applied AI' };
const BUNDLE_PRICE = 25000;
const PAYMENT_METHODS = { telebirr: 'Telebirr', cbe: 'CBE', cash: 'Cash' };

// Fixed two-course bundles, matched by course name (case/space-insensitive).
// If a registration selects exactly the two named courses in a pair, the fixed
// price applies instead of the sum of individual prices.
const PAIR_BUNDLES = [
  { courses: ['social media marketing', 'event organizing'], price: 10000, label: 'Social Media Marketing + Event Organizing' },
  { courses: ['canva for beginners', 'applied ai'], price: 8500, label: 'Canva for Beginners + Applied AI' },
];

const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Given the selected dynamic-course objects, returns a matching pair bundle or null.
function matchPairBundle(selected) {
  if (selected.length !== 2) return null;
  const names = selected.map((c) => normName(c.name)).sort();
  for (const pair of PAIR_BUNDLES) {
    const target = pair.courses.map(normName).sort();
    if (names[0] === target[0] && names[1] === target[1]) return pair;
  }
  return null;
}

function generatePortalId(existingIds = new Set()) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = 'GDA-';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  } while (existingIds.has(id));
  return id;
}

function resolveCourse(course, courseLabel, fee, dynamicCourses = [], bundleDiscount = 0) {
  // "All courses together" bundle. The registration page sends course:'all'
  // when every available (dynamic) course is selected.
  if (course === 'all') {
    // Prefer the dynamic course list (that's what the live site uses). Fall back
    // to the 3 legacy base courses only if no dynamic courses are configured.
    if (dynamicCourses.length >= 1) {
      const rawFee = dynamicCourses.reduce((s, c) => s + (Number(c.price) || Number(c.fee) || 0), 0);
      const discounted = bundleDiscount > 0 ? Math.round(rawFee * (1 - bundleDiscount / 100)) : rawFee;
      return {
        courseKey: 'all',
        courseLabel: courseLabel || 'All courses',
        fee: fee != null ? fee : discounted
      };
    }
    return {
      courseKey: 'all3',
      courseLabel: courseLabel || 'All 3 courses',
      fee: fee != null ? fee : BUNDLE_PRICE
    };
  }

  // All 3 bundle shortcut (legacy)
  if (course === 'all3' || course === 'both') {
    return {
      courseKey: 'all3',
      courseLabel: courseLabel || 'All 3 courses',
      fee: fee != null ? fee : BUNDLE_PRICE
    };
  }

  // Single known base course
  if (BASE_FEES[course] != null) {
    return {
      courseKey: course,
      courseLabel: courseLabel || BASE_LABELS[course],
      fee: fee != null ? fee : BASE_FEES[course]
    };
  }

  // Dynamic course created in admin Settings
  const dynCourse = dynamicCourses.find(c => String(c.id) === String(course));
  if (dynCourse) {
    return {
      courseKey: String(dynCourse.id),
      courseLabel: courseLabel || dynCourse.name || String(dynCourse.id),
      fee: fee != null ? fee : (dynCourse.fee || dynCourse.price || 0)
    };
  }

  // Combo like "digital+event" or "<id1>+<id2>" etc.
  if (course && course.includes('+')) {
    const parts = course.split('+').filter(p => BASE_FEES[p] != null || dynamicCourses.some(c => String(c.id) === p));
    if (parts.length < 2) return null;

    const all3 = ['digital', 'event', 'ai'].every(k => parts.includes(k));
    // All dynamic courses selected via the combo path → treat as the full bundle.
    const allDynamic = dynamicCourses.length >= 2 && dynamicCourses.every(c => parts.includes(String(c.id)));

    // Fixed two-course pair bundle (e.g. SMM + Event = 10,000).
    // Only applies when exactly two dynamic courses are selected and they match a pair.
    if (!allDynamic) {
      const selectedDyn = parts.map(k => dynamicCourses.find(c => String(c.id) === k)).filter(Boolean);
      const pair = matchPairBundle(selectedDyn);
      if (pair) {
        return {
          courseKey: course,
          courseLabel: courseLabel || pair.label,
          fee: fee != null ? fee : pair.price,
        };
      }
    }

    let computedFee = parts.reduce((s, k) => {
      if (BASE_FEES[k] != null) return s + BASE_FEES[k];
      const dc = dynamicCourses.find(c => String(c.id) === k);
      return s + (dc ? (Number(dc.price) || Number(dc.fee) || 0) : 0);
    }, 0);
    if (all3) {
      computedFee = BUNDLE_PRICE;
    } else if (allDynamic && bundleDiscount > 0) {
      computedFee = Math.round(computedFee * (1 - bundleDiscount / 100));
    }

    const computedLabel = (all3 || allDynamic) ? 'All courses' : parts.map(k => {
      if (BASE_LABELS[k]) return BASE_LABELS[k];
      const dc = dynamicCourses.find(c => String(c.id) === k);
      return dc ? dc.name : k;
    }).join(' + ');

    return {
      courseKey: all3 ? 'all3' : (allDynamic ? 'all' : course),
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
    proofUrl, proofPathname, manualEntry, classType,
    age, gender, guardian, guardianPhone, address
  } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!phone || !phone.trim()) return res.status(400).json({ error: 'Phone is required' });

  const data = await getData();
  const dynamicCourses = (data?.settings?.courses) || [];
  const bundleDiscount = Number(data?.settings?.bundleDiscount) || 0;

  // A manual (admin-entered) registration is only honored for an authenticated admin.
  // Public visitors always go through the normal proof-of-payment flow.
  const isAdmin = verifyAdmin(req.headers['x-admin-key'], data).ok;
  const isManual = !!manualEntry && isAdmin;

  const resolved = resolveCourse(course, courseLabel, fee, dynamicCourses, bundleDiscount);
  if (!resolved) return res.status(400).json({ error: 'Invalid course selection' });

  if (!paymentMethod || !PAYMENT_METHODS[paymentMethod]) {
    return res.status(400).json({ error: 'Please select a payment method' });
  }

  // Proof is required for public registrations but not manual admin entries
  if (!isManual && (!proofPathname || !proofPathname.trim())) {
    return res.status(400).json({ error: 'Please attach your proof of payment' });
  }

  // Generate unique portal ID for student
  const existingPortalIds = new Set(data.students.map(s => s.portalId).filter(Boolean));
  const portalId = generatePortalId(existingPortalIds);

  const isVerified = isManual
    ? (paymentStatus === 'verified')
    : false;

  const student = {
    id: 's_' + Date.now(),
    name: name.trim(),
    phone: phone.trim(),
    email: (email || '').trim(),
    age: (age !== undefined && age !== null && age !== '') ? parseInt(age) : null,
    gender: (gender === 'Male' || gender === 'Female') ? gender : '',
    guardian: (guardian || '').trim(),
    guardianPhone: (guardianPhone || '').trim(),
    address: (address || '').trim(),
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
    manualEntry: isManual,
    classType: classType || 'in-person',
    status: 'ongoing',
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
