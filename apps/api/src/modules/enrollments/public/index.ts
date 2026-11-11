export const ENROLLMENT_ACCESS = Symbol('ENROLLMENT_ACCESS');
/** Read-only contract over the local projection of the Academic Registry roster. Courses never manage enrollments. */
export interface EnrollmentAccess {
  isEnrolled(studentId: string, courseId: string): Promise<boolean>;
  /** Course IDs where the student is currently enrolled. */
  coursesOf(studentId: string): Promise<string[]>;
  /** Student IDs currently enrolled in the course. */
  studentsOf(courseId: string): Promise<string[]>;
}

export const REGISTRY_SECTIONS = Symbol('REGISTRY_SECTIONS');
/** Courses report the registry section (code + period) of each course so the nightly synchronization can find it. Idempotent. */
export interface RegistrySections { link(courseId: string, code: string, period: string): Promise<void> }

export const REGISTRY_SYNC_STATUS = Symbol('REGISTRY_SYNC_STATUS');
export interface RegistrySyncSummary {
  readonly id: string; readonly trigger: 'SCHEDULED' | 'MANUAL'; readonly status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  readonly startedAt: string; readonly finishedAt: string | null; readonly error: string | null; readonly retries: number; readonly sections: number;
}
/** Read-only view of the synchronization runs (monitoring and alerts). */
export interface RegistrySyncStatus { recentRuns(limit: number): Promise<RegistrySyncSummary[]> }
