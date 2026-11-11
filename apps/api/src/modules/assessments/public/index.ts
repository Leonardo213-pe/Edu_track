export const ASSESSMENT_CATALOG = Symbol('ASSESSMENT_CATALOG');
/** What grading may know about an assessment. Answer keys are not part of this read contract. */
export interface GradableAssessment {
  readonly id: string; readonly courseId: string; readonly title: string; readonly type: 'QUIZ' | 'RUBRIC';
  readonly weightBp: number; readonly status: 'PUBLISHED' | 'CLOSED'; readonly dueAt: string;
  readonly criteria: readonly { readonly id: string; readonly description: string; readonly maxPointsCents: number }[];
}
export interface AssessmentCatalog {
  /** Published or closed assessments of a course (the ones that count for the weighted average). */
  gradable(courseId: string): Promise<GradableAssessment[]>;
  findGradable(id: string): Promise<GradableAssessment | null>;
}
