import type { Reconciliation, RosterEntry } from '../domain/enrollment';
export interface EnrollmentRun { id: string; courseId: string; actorId: string; source: string; added: number; removed: number; total: number; occurredAt: string }
export interface EnrollmentRepository {
  isEnrolled(studentId: string, courseId: string): Promise<boolean>;
  activeCourses(studentId: string): Promise<string[]>;
  roster(courseId: string): Promise<RosterEntry[]>;
  /** Locks the course roster, computes the reconciliation on the current rows, applies it and appends the run atomically. */
  reconcile(courseId: string, decide: (current: RosterEntry[]) => Reconciliation, run: Omit<EnrollmentRun, 'added' | 'removed' | 'total'>): Promise<Reconciliation>;
  runs(courseId: string, limit: number): Promise<EnrollmentRun[]>;
}
export interface DirectoryUser { id: string; email: string; displayName: string; role: string; active: boolean }
export interface EnrollmentDirectory {
  byIds(ids: string[]): Promise<DirectoryUser[]>;
  byEmails(emails: string[]): Promise<DirectoryUser[]>;
}
export interface EnrollmentRuntime { id(): string; now(): string }
