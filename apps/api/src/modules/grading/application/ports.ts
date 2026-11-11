import type { Grade } from '../domain/grading';
/** Local view of a gradable assessment (adapted from the assessments public contract in the composition root). */
export interface GradableAssessment {
  readonly id: string; readonly courseId: string; readonly title: string; readonly type: 'QUIZ' | 'RUBRIC';
  readonly weightBp: number; readonly status: 'PUBLISHED' | 'CLOSED'; readonly dueAt: string;
  readonly criteria: readonly { readonly id: string; readonly description: string; readonly maxPointsCents: number }[];
}
export interface GradeRepository {
  forCourse(courseId: string): Promise<Grade[]>;
  forStudent(courseId: string, studentId: string): Promise<Grade[]>;
  find(assessmentId: string, studentId: string): Promise<Grade | null>;
  /**
   * Inserts (expectedVersion null) or replaces the current grade with optimistic concurrency. The actor is declared to
   * the audit contract in the same transaction; the database audits every insert/update atomically (CAR-12).
   */
  save(grade: Grade, expectedVersion: number | null, actorId: string): Promise<void>;
}
export interface GradingAssessments {
  gradable(courseId: string): Promise<GradableAssessment[]>;
  findGradable(id: string): Promise<GradableAssessment | null>;
}
export interface GradingCourses { describe(courseId: string): Promise<{ id: string; code: string; name: string; teacherId: string; status: string } | null> }
export interface GradingEnrollment { has(studentId: string, courseId: string): Promise<boolean>; studentsOf(courseId: string): Promise<string[]> }
export interface GradingDirectory {
  role(id: string): Promise<string | null>;
  names(ids: string[]): Promise<Map<string, string>>;
}
export interface GradingRuntime { id(): string; now(): string }
