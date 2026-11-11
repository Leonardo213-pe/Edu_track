import { AnalyticsError, DEFAULT_RULES, assessRisk, daysSince, validateRules } from '../domain/risk';
import type { AnalyticsAssessments, AnalyticsCourses, AnalyticsDirectory, AnalyticsEnrollment, AnalyticsGrades, AnalyticsRepository, AnalyticsRuntime } from './ports';

/** CU-11 / CAR-08: connection time, progress and explainable risk per student, from public contracts (no foreign tables). */
export class AnalyticsService {
  constructor(private readonly repo: AnalyticsRepository, private readonly directory: AnalyticsDirectory, private readonly courses: AnalyticsCourses,
    private readonly enrollments: AnalyticsEnrollment, private readonly grades: AnalyticsGrades, private readonly assessments: AnalyticsAssessments,
    private readonly runtime: AnalyticsRuntime) {}

  private async course(courseId: string) {
    const course = await this.courses.describe(courseId); if (!course) throw new AnalyticsError('NOT_FOUND'); return course;
  }
  /** Teacher responsible, admin and instructional designer monitor; only teacher/admin change the rules. */
  private async staff(actorId: string, courseId: string, change = false) {
    const course = await this.course(courseId); const role = await this.directory.role(actorId);
    const allowed = role === 'ADMIN' || (role === 'TEACHER' && course.teacherId === actorId) || (!change && role === 'INSTRUCTIONAL_DESIGNER');
    if (!allowed) throw new AnalyticsError('FORBIDDEN');
    return course;
  }
  /** Only enrolled students of a published course accumulate connection time; other roles are ignored. */
  async heartbeat(actorId: string, courseId: string): Promise<{ tracked: boolean; minutesToday: number | null }> {
    if (await this.directory.role(actorId) !== 'STUDENT') return { tracked: false, minutesToday: null };
    const course = await this.course(courseId);
    if (course.status !== 'PUBLICADO' || !await this.enrollments.has(actorId, courseId)) throw new AnalyticsError('FORBIDDEN');
    return { tracked: true, minutesToday: await this.repo.heartbeat(actorId, courseId) };
  }
  async rules(actorId: string, courseId: string) {
    await this.staff(actorId, courseId); const stored = await this.repo.rules(courseId);
    return stored ? { ...stored, custom: true } : { ...DEFAULT_RULES, custom: false };
  }
  async updateRules(actorId: string, courseId: string, input: { minProgress: unknown; minAverage: unknown; maxInactiveDays: unknown; maxMissed: unknown }) {
    await this.staff(actorId, courseId, true); await this.repo.saveRules(courseId, validateRules(input), actorId); return this.dashboard(actorId, courseId);
  }
  async dashboard(actorId: string, courseId: string) {
    const course = await this.staff(actorId, courseId); const now = this.runtime.now();
    const [students, progress, standing, activity, assessments, stored] = await Promise.all([this.enrollments.studentsOf(courseId), this.courses.progressOf(courseId),
      this.grades.standing(courseId), this.repo.activity(courseId), this.assessments.gradable(courseId), this.repo.rules(courseId)]);
    const rules = stored ?? DEFAULT_RULES; const names = await this.directory.names(students);
    const overdue = assessments.filter(item => new Date(item.dueAt).getTime() < now.getTime());
    const rows = students.map(studentId => {
      const own = standing.find(item => item.studentId === studentId); const seen = activity.find(item => item.userId === studentId);
      const signals = { progress: progress.find(item => item.studentId === studentId)?.percentage ?? 0, averageCents: own?.currentCents ?? null,
        inactiveDays: daysSince(seen?.lastSeenAt ?? null, now), missed: overdue.filter(item => !own?.gradedAssessmentIds.includes(item.id)).length };
      const risk = assessRisk(signals, rules);
      return { studentId, displayName: names.get(studentId) ?? studentId, progress: signals.progress, average: signals.averageCents === null ? null : signals.averageCents / 100,
        missed: signals.missed, inactiveDays: signals.inactiveDays, totalMinutes: seen?.totalMinutes ?? 0, lastWeekMinutes: seen?.lastWeekMinutes ?? 0,
        lastSeenAt: seen?.lastSeenAt.toISOString() ?? null, level: risk.level, reasons: risk.reasons };
    }).sort((a, b) => ['ALTO', 'MEDIO', 'BAJO'].indexOf(a.level) - ['ALTO', 'MEDIO', 'BAJO'].indexOf(b.level) || a.displayName.localeCompare(b.displayName, 'es'));
    return { courseId, courseName: course.name, generatedAt: now.toISOString(),
      rules: { minProgress: rules.minProgress, minAverage: rules.minAverageCents / 100, maxInactiveDays: rules.maxInactiveDays, maxMissed: rules.maxMissed, custom: !!stored },
      summary: { students: rows.length, ALTO: rows.filter(row => row.level === 'ALTO').length, MEDIO: rows.filter(row => row.level === 'MEDIO').length,
        BAJO: rows.filter(row => row.level === 'BAJO').length }, students: rows };
  }
}
