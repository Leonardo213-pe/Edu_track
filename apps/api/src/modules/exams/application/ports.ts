import type { Attempt, AttemptQuestion, ExamDefinition, SavedAnswer } from '../domain/attempt';
export interface SaveResult { accepted: boolean; questionId: string; optionIds: string[]; version: number; savedAt: string }
export interface AttemptSummary { attempt: Attempt; answered: number }
export interface ExamRepository {
  /** Database clock: the only time source that decides deadlines (EAC-03). */
  now(): Promise<Date>;
  find(id: string): Promise<Attempt | null>;
  findByStudent(assessmentId: string, studentId: string): Promise<Attempt | null>;
  forAssessment(assessmentId: string): Promise<AttemptSummary[]>;
  answers(attemptId: string): Promise<SavedAnswer[]>;
  /** Inserts the attempt; if the student already has one for the assessment, returns that one instead (idempotent start). */
  create(attempt: Attempt): Promise<Attempt>;
  /**
   * Stores the answer only while the attempt is open by the database clock and only if `version` is greater than the
   * stored one; returns the stored state either way. Commits before returning: the ACK means durable (ADR-004).
   */
  saveAnswer(attemptId: string, questionId: string, optionIds: string[], version: number): Promise<SaveResult>;
  /** Atomically finalizes an open attempt (SUBMITTED, or EXPIRED if past due) and writes AttemptFinalized to the outbox. */
  finalize(attemptId: string): Promise<Attempt>;
  /** Finalizes up to `limit` expired attempts (safe with several replicas) and writes their events; returns how many. */
  expireDue(limit: number): Promise<number>;
}
export interface ExamAssessments {
  definition(assessmentId: string): Promise<ExamDefinition | null>;
  draw(assessmentId: string): Promise<AttemptQuestion[]>;
  answerKey(assessmentId: string): Promise<{ questionId: string; pointsCents: number; correctOptionIds: string[] }[]>;
}
export interface ExamCourses { describe(courseId: string): Promise<{ id: string; teacherId: string; status: string } | null> }
export interface ExamEnrollment { has(studentId: string, courseId: string): Promise<boolean> }
export interface ExamDirectory { role(id: string): Promise<string | null>; names(ids: string[]): Promise<Map<string, string>> }
export interface ExamGrades {
  recordAutomatic(input: { assessmentId: string; courseId: string; studentId: string; sourceId: string;
    questions: { questionId: string; pointsCents: number; correctOptionIds: string[] }[]; answers: Record<string, string[]> }): Promise<{ scoreCents: number }>;
  scoreOf(assessmentId: string, studentId: string): Promise<number | null>;
}
export interface ExamRuntime { id(): string }
