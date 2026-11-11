import { EnrollmentError, MAX_ROSTER, reconcile } from '../domain/enrollment';
import type { EnrollmentAccess } from '../public';
import type { EnrollmentDirectory, EnrollmentRepository, EnrollmentRuntime } from './ports';

/**
 * Consumes the official enrollment list (CAR-09/RES-01). Until the Academic Registry adapter exists, an administrator
 * supplies that official list; the LMS never creates enrollments of its own.
 */
export class EnrollmentService implements EnrollmentAccess {
  constructor(private readonly repo: EnrollmentRepository, private readonly directory: EnrollmentDirectory, private readonly clock: EnrollmentRuntime) {}

  isEnrolled(studentId: string, courseId: string): Promise<boolean> { return this.repo.isEnrolled(studentId, courseId); }
  coursesOf(studentId: string): Promise<string[]> { return this.repo.activeCourses(studentId); }

  private async administrator(actorId: string): Promise<void> {
    const [actor] = await this.directory.byIds([actorId]);
    if (!actor?.active || actor.role !== 'ADMIN') throw new EnrollmentError('FORBIDDEN');
  }
  async roster(actorId: string, courseId: string) {
    await this.administrator(actorId);
    const active = (await this.repo.roster(courseId)).filter(entry => entry.active).map(entry => entry.studentId);
    const users = new Map((await this.directory.byIds(active)).map(user => [user.id, user]));
    const students = active.map(id => ({ id, displayName: users.get(id)?.displayName ?? id, email: users.get(id)?.email ?? null }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));
    return { courseId, students, runs: await this.repo.runs(courseId, 20) };
  }
  /** Replaces the course roster with the official list of student emails, atomically and idempotently. */
  async synchronize(actorId: string, courseId: string, emails: readonly string[]) {
    await this.administrator(actorId);
    if (emails.length > MAX_ROSTER) throw new EnrollmentError('INVALID_INPUT');
    const requested = [...new Set(emails.map(email => email.trim().toLowerCase()).filter(Boolean))];
    const found = new Map((await this.directory.byEmails(requested)).map(user => [user.email, user]));
    const unknown = requested.filter(email => { const user = found.get(email); return !user || !user.active || user.role !== 'STUDENT'; });
    if (unknown.length) throw new EnrollmentError('UNKNOWN_STUDENTS', unknown);
    const ids = requested.map(email => found.get(email)!.id);
    const result = await this.repo.reconcile(courseId, current => reconcile(current, ids),
      { id: this.clock.id(), courseId, actorId, source: 'ADMIN_OFFICIAL_LIST', occurredAt: this.clock.now() });
    return { added: result.activate.length, removed: result.deactivate.length, unchanged: result.unchanged, total: result.total, ...(await this.roster(actorId, courseId)) };
  }
}
