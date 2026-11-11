/** Assignment submissions (CAR-05, CU-04). Pure rules about who may submit and see what. */
export type SubmissionErrorCode = 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'NOT_ENROLLED' | 'NOT_AN_ASSIGNMENT' | 'NOT_AVAILABLE' | 'DEADLINE_PASSED' | 'FILE_REJECTED';
export class SubmissionError extends Error {
  constructor(readonly code: SubmissionErrorCode) { super(code); }
}
export type Role = 'STUDENT' | 'TEACHER' | 'INSTRUCTIONAL_DESIGNER' | 'ADMIN';
export interface Actor { readonly id: string; readonly role: Role }
/** What submissions needs to know about the assignment (rubric assessment, the "Tarea" of the report). */
export interface Assignment {
  readonly id: string; readonly courseId: string; readonly title: string; readonly type: 'QUIZ' | 'RUBRIC';
  readonly status: 'DRAFT' | 'PUBLISHED' | 'CLOSED'; readonly dueAt: string;
}
export interface CourseFacts { readonly id: string; readonly teacherId: string; readonly status: string; readonly name: string }
/** Formats accepted for assignments and the size bound (validated again by content in the storage adapter). */
export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.txt'] as const;
export const MAX_SUBMISSION_BYTES = 10 * 1024 * 1024;

/**
 * A student may submit (or replace the file) while the assignment is PUBLISHED and the course PUBLICADO, only if
 * enrolled. The deadline itself is decided with the database clock inside the storing transaction.
 */
export function assertCanSubmit(actor: Actor, assignment: Assignment | null, course: CourseFacts | null, enrolled: boolean): asserts assignment is Assignment {
  if (actor.role !== 'STUDENT') throw new SubmissionError('FORBIDDEN');
  if (!assignment || !course || assignment.status === 'DRAFT' || course.status !== 'PUBLICADO') throw new SubmissionError('NOT_FOUND');
  if (assignment.type !== 'RUBRIC') throw new SubmissionError('NOT_AN_ASSIGNMENT');
  if (!enrolled) throw new SubmissionError('NOT_ENROLLED');
  if (assignment.status !== 'PUBLISHED') throw new SubmissionError('NOT_AVAILABLE');
}
/** Staff who can review submissions: the responsible teacher grades; an ADMIN may only read. */
export function staffAccess(actor: Actor, course: CourseFacts): 'TEACHER' | 'ADMIN' {
  if (actor.role === 'ADMIN') return 'ADMIN';
  if (actor.role === 'TEACHER' && course.teacherId === actor.id) return 'TEACHER';
  throw new SubmissionError('FORBIDDEN');
}
export function validFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some(extension => lower.endsWith(extension));
}
