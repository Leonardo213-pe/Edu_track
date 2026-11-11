/** Grading scale agreed for the LMS (not the official academic record): vigesimal, pass mark 11. */
export const GRADING_SCALE = { max: 20, passing: 11, decimals: 2 } as const;

export const GRADE_RECORDER = Symbol('GRADE_RECORDER');
export interface AutomaticGradeInput {
  readonly assessmentId: string; readonly courseId: string; readonly studentId: string;
  /** Identifier of the graded source (the exam attempt): repeating the same source never creates a second grade. */
  readonly sourceId: string;
  readonly questions: readonly { readonly questionId: string; readonly pointsCents: number; readonly correctOptionIds: readonly string[] }[];
  readonly answers: Readonly<Record<string, readonly string[]>>;
}
/** Contract used by exams: automatic grading with the Strategy of CAR-06, audited atomically as the system actor. */
export interface GradeRecorder {
  recordAutomatic(input: AutomaticGradeInput): Promise<{ scoreCents: number }>;
  scoreOf(assessmentId: string, studentId: string): Promise<number | null>;
}
