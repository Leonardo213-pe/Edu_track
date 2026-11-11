import type { RiskRules } from '../domain/risk';
export interface ActivitySummary { userId: string; totalMinutes: number; lastWeekMinutes: number; lastSeenAt: Date }
export interface AnalyticsRepository {
  /** Counts one connected minute per heartbeat at most every ~50 s (database clock); returns today's minutes. */
  heartbeat(userId: string, courseId: string): Promise<number | null>;
  activity(courseId: string): Promise<ActivitySummary[]>;
  rules(courseId: string): Promise<(RiskRules & { updatedBy: string; updatedAt: string }) | null>;
  saveRules(courseId: string, rules: RiskRules, actorId: string): Promise<void>;
}
export interface AnalyticsDirectory { role(id: string): Promise<string | null>; names(ids: string[]): Promise<Map<string, string>> }
export interface AnalyticsCourses {
  describe(courseId: string): Promise<{ id: string; code: string; name: string; teacherId: string; status: string } | null>;
  progressOf(courseId: string): Promise<{ studentId: string; percentage: number }[]>;
}
export interface AnalyticsEnrollment { has(studentId: string, courseId: string): Promise<boolean>; studentsOf(courseId: string): Promise<string[]> }
export interface AnalyticsGrades { standing(courseId: string): Promise<{ studentId: string; currentCents: number | null; gradedAssessmentIds: readonly string[] }[]> }
export interface AnalyticsAssessments { gradable(courseId: string): Promise<{ id: string; dueAt: string }[]> }
export interface AnalyticsRuntime { now(): Date }
