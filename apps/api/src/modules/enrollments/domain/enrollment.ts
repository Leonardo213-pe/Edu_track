export class EnrollmentError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'FORBIDDEN' | 'UNKNOWN_STUDENTS', readonly details: readonly string[] = []) { super(code); }
}
export interface RosterEntry { readonly studentId: string; readonly active: boolean }
export interface Reconciliation { readonly activate: readonly string[]; readonly deactivate: readonly string[]; readonly unchanged: number; readonly total: number }
/** Matches the identity directory lookup bound; larger sections require the batch Academic Registry adapter. */
export const MAX_ROSTER = 1000;

/**
 * Idempotent reconciliation of the official list of enrolled students (Academic Registry) with the local projection:
 * new students are activated (altas/reactivaciones), students missing from the official list are deactivated (bajas).
 * Applying the same list twice produces no changes.
 */
export function reconcile(current: readonly RosterEntry[], official: readonly string[]): Reconciliation {
  if (official.length > MAX_ROSTER || official.some(id => typeof id !== 'string' || !id)) throw new EnrollmentError('INVALID_INPUT');
  const wanted = new Set(official);
  const active = new Set(current.filter(entry => entry.active).map(entry => entry.studentId));
  const activate = [...wanted].filter(id => !active.has(id)).sort();
  const deactivate = [...active].filter(id => !wanted.has(id)).sort();
  return { activate, deactivate, unchanged: wanted.size - activate.length, total: wanted.size };
}
