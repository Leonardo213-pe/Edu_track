export const ENROLLMENT_ACCESS = Symbol('ENROLLMENT_ACCESS');
// Read-only projection contract; no enrollment management in Courses.
export interface EnrollmentAccess { isEnrolled(studentId: string, courseId: string): Promise<boolean> }
