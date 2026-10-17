// Seats are counted per registration round and per class type (in-person / online).
// A student takes a seat once their payment is confirmed (paid / verified) and they haven't dropped out.
// Students saved before rounds existed have no `round` field and belong to DEFAULT_ROUND_ID.

export const DEFAULT_ROUND_ID = 'r1';

export function roundIdOf(student) {
  return student.round || DEFAULT_ROUND_ID;
}

function isConfirmed(student) {
  return student.paid === true || student.paymentStatus === 'verified';
}

export function takenSeats(students, roundId, classType) {
  return (students || []).filter(
    (s) =>
      isConfirmed(s) &&
      s.status !== 'dropped' &&
      roundIdOf(s) === roundId &&
      (s.classType || 'in-person') === classType
  ).length;
}

// total 0 = unlimited (left is null).
export function seatInfo(students, round, classType) {
  const total = Number(round?.seats?.[classType]) || 0;
  const taken = takenSeats(students, round?.id || DEFAULT_ROUND_ID, classType);
  return { total, taken, left: total > 0 ? Math.max(0, total - taken) : null };
}
