export const ENROLLMENT_ACCESS = Symbol('ENROLLMENT_ACCESS');
/** Read-only contract over the local projection of the Academic Registry roster. Courses never manage enrollments. */
export interface EnrollmentAccess {
  isEnrolled(studentId: string, courseId: string): Promise<boolean>;
  /** Course IDs where the student is currently enrolled. */
  coursesOf(studentId: string): Promise<string[]>;
}
