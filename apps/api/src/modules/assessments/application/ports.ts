import type { Assessment, SnapshotQuestion } from '../domain/assessment';
import type { Question } from '../domain/question';
export interface Bank { id: string; courseId: string; name: string; createdAt: string }
export interface AssessmentRepository {
  banks(courseId: string): Promise<(Bank & { questions: Question[] })[]>;
  findBank(id: string): Promise<Bank | null>;
  createBank(bank: Bank): Promise<void>;
  findQuestion(id: string): Promise<Question | null>;
  bankQuestions(bankId: string): Promise<Question[]>;
  /** Inserts (expectedVersion null) or updates a question with optimistic concurrency. */
  saveQuestion(question: Question, expectedVersion: number | null): Promise<void>;
  list(courseId: string): Promise<Assessment[]>;
  find(id: string): Promise<Assessment | null>;
  /** Locks the course assessments; `decide` sees all current siblings before the new assessment is inserted. */
  create(assessment: Assessment, decide: (siblings: Assessment[]) => void): Promise<void>;
  /**
   * Locks the course assessments, checks the revision, applies the work and persists it. The actor is declared to the
   * audit contract in the same transaction, so publication and any later change are audited atomically.
   */
  mutate(id: string, revision: number, actorId: string, work: (assessment: Assessment, siblings: Assessment[]) => Promise<SnapshotQuestion[] | void>): Promise<Assessment>;
  remove(id: string, revision: number): Promise<void>;
  snapshot(id: string): Promise<SnapshotQuestion[]>;
  dueBetween(from: string, to: string): Promise<Assessment[]>;
}
export interface CourseSummary { id: string; code: string; name: string; teacherId: string; status: string }
export interface AssessmentCourses { describe(courseId: string): Promise<CourseSummary | null> }
export interface AssessmentActor { id: string; role: 'ADMIN' | 'TEACHER' | 'INSTRUCTIONAL_DESIGNER' | 'STUDENT' }
export interface AssessmentDirectory { find(id: string): Promise<AssessmentActor | null> }
export interface AssessmentEnrollment { has(studentId: string, courseId: string): Promise<boolean> }
export interface AssessmentRuntime { id(): string; now(): string; random(): number }
