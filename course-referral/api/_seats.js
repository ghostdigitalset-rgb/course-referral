// Seat counting. A student takes a seat in a course once their payment is confirmed
// (paid / verified) and they haven't dropped out. Bundles count against every course they include.

function coversCourse(student, courseId) {
  const key = String(student.course || '');
  if (!key) return false;
  if (key === 'all' || key === 'all3' || key === 'both') return true;
  if (key === courseId) return true;
  if (key.includes('+')) return key.split('+').includes(courseId);
  return false;
}

function isConfirmed(student) {
  return student.paid === true || student.paymentStatus === 'verified';
}

export function enrolledCount(students, courseId) {
  return (students || []).filter(
    (s) => isConfirmed(s) && s.status !== 'dropped' && coversCourse(s, String(courseId))
  ).length;
}

// Course ids a resolved course key covers, e.g. 'all' -> every dynamic course,
// 'abc+def' -> ['abc','def'], 'abc' -> ['abc'].
export function courseIdsFor(courseKey, dynamicCourses) {
  if (courseKey === 'all' || courseKey === 'all3') {
    return dynamicCourses.map((c) => String(c.id));
  }
  return String(courseKey).split('+').filter((k) => dynamicCourses.some((c) => String(c.id) === k));
}
