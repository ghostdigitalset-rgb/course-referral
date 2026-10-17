// Every course has its own registration round, with its own open/closed state and its own
// In-person and Online seats. A student takes a seat in a course once their payment is confirmed
// (paid / verified) and they haven't dropped out. Bundles take a seat in every course they include.
//
// Each student stores the round they joined per course: student.roundIds = { courseId: roundId }.
// Students saved before per-course rounds have no roundIds and fall back to their old `round` id.

export const DEFAULT_ROUND_ID = 'r1';

export function roundIdFor(student, courseId) {
  // Students saved by the earlier single-round version only have `round`.
  return (student.roundIds && student.roundIds[courseId]) || student.round || DEFAULT_ROUND_ID;
}

function isConfirmed(student) {
  return student.paid === true || student.paymentStatus === 'verified';
}

function coversCourse(student, courseId) {
  const key = String(student.course || '');
  if (!key) return false;
  if (key === 'all' || key === 'all3' || key === 'both') return true;
  if (key === courseId) return true;
  if (key.includes('+')) return key.split('+').includes(courseId);
  return false;
}

export function takenSeats(students, course, classType) {
  const courseId = String(course.id);
  const roundId = course.round?.id || DEFAULT_ROUND_ID;
  return (students || []).filter(
    (s) =>
      isConfirmed(s) &&
      s.status !== 'dropped' &&
      coversCourse(s, courseId) &&
      roundIdFor(s, courseId) === roundId &&
      (s.classType || 'in-person') === classType
  ).length;
}

// total 0 = unlimited (left is null).
export function seatInfo(students, course, classType) {
  const total = Number(course.round?.seats?.[classType]) || 0;
  const taken = takenSeats(students, course, classType);
  return { total, taken, left: total > 0 ? Math.max(0, total - taken) : null };
}

// Course ids a resolved course key covers: 'all' -> every course, 'a+b' -> ['a','b'], 'a' -> ['a'].
export function courseIdsFor(courseKey, dynamicCourses) {
  if (courseKey === 'all' || courseKey === 'all3') {
    return dynamicCourses.map((c) => String(c.id));
  }
  return String(courseKey).split('+').filter((k) => dynamicCourses.some((c) => String(c.id) === k));
}
