export const ASSESSMENT_CATALOG = Symbol('ASSESSMENT_CATALOG');
/** What grading may know about an assessment. Answer keys are not part of this read contract. */
export interface GradableAssessment {
  readonly id: string; readonly courseId: string; readonly title: string; readonly type: 'QUIZ' | 'RUBRIC';
  readonly weightBp: number; readonly status: 'PUBLISHED' | 'CLOSED'; readonly dueAt: string;
  readonly criteria: readonly { readonly id: string; readonly description: string; readonly maxPointsCents: number }[];
}
export interface ExamDefinition {
  readonly id: string; readonly courseId: string; readonly title: string; readonly status: 'DRAFT' | 'PUBLISHED' | 'CLOSED'; readonly type: 'QUIZ' | 'RUBRIC';
  readonly dueAt: string; readonly durationMinutes: number | null; readonly questionCount: number | null;
}
/** Question drawn for one attempt, as a student may see it (no correct flags). */
export interface DrawnQuestion {
  readonly questionId: string; readonly position: number; readonly type: 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE'; readonly statement: string;
  readonly pointsCents: number; readonly options: readonly { readonly id: string; readonly text: string }[];
}
export interface AnswerKeyItem { readonly questionId: string; readonly pointsCents: number; readonly correctOptionIds: readonly string[] }
export interface AssessmentCatalog {
  /** Published or closed assessments of a course (the ones that count for the weighted average). */
  gradable(courseId: string): Promise<GradableAssessment[]>;
  findGradable(id: string): Promise<GradableAssessment | null>;
  examDefinition(id: string): Promise<ExamDefinition | null>;
  /** Random draw of `questionCount` questions from the frozen snapshot of a published quiz. */
  drawForAttempt(id: string): Promise<DrawnQuestion[]>;
  /** Server-side only (automatic grading); never exposed over HTTP. */
  answerKey(id: string): Promise<AnswerKeyItem[]>;
}
