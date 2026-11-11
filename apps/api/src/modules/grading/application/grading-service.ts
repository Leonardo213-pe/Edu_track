import { Grade, GradingError, PASSING_GRADE, SCALE_MAX_CENTS, strategyFor, weightedAverage, type Average } from '../domain/grading';
import type { AutomaticGradeInput } from '../public';
import type { GradableAssessment, GradeNotifier, GradeRepository, GradingAssessments, GradingCourses, GradingDirectory, GradingEnrollment, GradingRuntime } from './ports';

const points = (cents: number | null) => cents === null ? null : cents / 100;
function averageView(average: Average) {
  return { current: points(average.currentCents), final: points(average.finalCents), finalRounded: average.finalRounded, approved: average.approved,
    gradedWeight: average.gradedWeightBp / 100, totalWeight: average.totalWeightBp / 100, complete: average.complete };
}
function assessmentView(assessment: GradableAssessment) {
  return { id: assessment.id, title: assessment.title, type: assessment.type, weight: assessment.weightBp / 100, status: assessment.status, dueAt: assessment.dueAt,
    criteria: assessment.criteria.map(item => ({ id: item.id, description: item.description, maxPoints: item.maxPointsCents / 100 })) };
}
function gradeView(grade: Grade) {
  const data = grade.data;
  return { assessmentId: data.assessmentId, score: data.scoreCents / 100, origin: data.origin, detail: data.detail, reason: data.reason, gradedAt: data.gradedAt, version: data.version };
}

/** CU-08: grading with Strategy, weighted averages and atomic audit of every grade change. */
export class GradingService {
  constructor(private readonly grades: GradeRepository, private readonly assessments: GradingAssessments, private readonly courses: GradingCourses,
    private readonly enrollments: GradingEnrollment, private readonly directory: GradingDirectory, private readonly runtime: GradingRuntime,
    private readonly notifier: GradeNotifier = { gradeRecorded: async () => undefined }) {}

  private announce(grade: Grade, title: string): void {
    void this.notifier.gradeRecorded({ studentId: grade.data.studentId, courseId: grade.data.courseId, assessmentId: grade.data.assessmentId, title,
      score: grade.data.scoreCents / 100 }).catch(() => undefined);
  }
  /** Standing of every enrolled student for analytics (risk rules). */
  async standing(courseId: string) {
    const [assessments, grades, students] = await Promise.all([this.assessments.gradable(courseId), this.grades.forCourse(courseId), this.enrollments.studentsOf(courseId)]);
    return students.map(studentId => {
      const own = grades.filter(grade => grade.data.studentId === studentId && assessments.some(item => item.id === grade.data.assessmentId));
      const average = GradingService.average(assessments, own);
      return { studentId, currentCents: average.currentCents, finalCents: average.finalCents, gradedAssessmentIds: own.map(grade => grade.data.assessmentId) };
    });
  }

  readonly scale = { max: SCALE_MAX_CENTS / 100, passing: PASSING_GRADE };
  private async course(courseId: string) {
    const course = await this.courses.describe(courseId); if (!course) throw new GradingError('NOT_FOUND'); return course;
  }
  private static average(assessments: GradableAssessment[], grades: Grade[]) {
    return weightedAverage(assessments.map(assessment => ({ weightBp: assessment.weightBp,
      scoreCents: grades.find(grade => grade.data.assessmentId === assessment.id)?.data.scoreCents ?? null })));
  }

  /** Teacher responsible (and ADMIN, read-only) sees every enrolled student, their grades and weighted averages. */
  async gradebook(actorId: string, courseId: string) {
    const course = await this.course(courseId); const role = await this.directory.role(actorId);
    if (role !== 'ADMIN' && !(role === 'TEACHER' && course.teacherId === actorId)) throw new GradingError('FORBIDDEN');
    const [assessments, grades, studentIds] = await Promise.all([this.assessments.gradable(courseId), this.grades.forCourse(courseId), this.enrollments.studentsOf(courseId)]);
    const names = await this.directory.names(studentIds);
    const students = studentIds.map(studentId => {
      const own = grades.filter(grade => grade.data.studentId === studentId);
      return { studentId, displayName: names.get(studentId) ?? studentId, grades: own.map(gradeView), average: averageView(GradingService.average(assessments, own)) };
    }).sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));
    return { courseId, scale: this.scale, canGrade: role === 'TEACHER', assessments: assessments.map(assessmentView), students };
  }

  /** Rubric grade by the responsible teacher; changing an existing grade requires the current version and a reason. */
  async gradeRubric(actorId: string, assessmentId: string, studentId: string, input: { awards: { criterionId: string; points: number }[]; reason?: string; version?: number }) {
    const assessment = await this.assessments.findGradable(assessmentId); if (!assessment) throw new GradingError('NOT_GRADABLE');
    if (assessment.type !== 'RUBRIC') throw new GradingError('NOT_GRADABLE');
    const course = await this.course(assessment.courseId);
    if (await this.directory.role(actorId) !== 'TEACHER' || course.teacherId !== actorId) throw new GradingError('FORBIDDEN');
    if (!await this.enrollments.has(studentId, assessment.courseId)) throw new GradingError('NOT_ENROLLED');
    const strategy = strategyFor(assessment.type);
    const result = strategy.grade({ criteria: assessment.criteria, awards: input.awards });
    const current = await this.grades.find(assessmentId, studentId); const now = this.runtime.now();
    if (current) {
      if (input.version !== current.data.version) throw new GradingError('CONFLICT');
      const next = current.revise(result, strategy.origin, input.reason ?? '', actorId, now);
      await this.grades.save(next, current.data.version, actorId); this.announce(next, assessment.title); return gradeView(next);
    }
    if (input.version !== undefined) throw new GradingError('CONFLICT');
    const grade = Grade.first({ id: this.runtime.id(), assessmentId, courseId: assessment.courseId, studentId, gradedBy: actorId, gradedAt: now },
      result, strategy.origin, input.reason ?? '');
    await this.grades.save(grade, null, actorId); this.announce(grade, assessment.title); return gradeView(grade);
  }

  /**
   * Automatic grade of a finalized attempt (CU-03 step 5). Idempotent per source: a retried event returns the stored
   * grade. Recorded with the system actor so the audit entry shows it was not a manual change.
   */
  async recordAutomatic(input: AutomaticGradeInput, systemActorId: string): Promise<{ scoreCents: number }> {
    const assessment = await this.assessments.findGradable(input.assessmentId);
    if (!assessment || assessment.type !== 'QUIZ' || assessment.courseId !== input.courseId) throw new GradingError('NOT_GRADABLE');
    const current = await this.grades.find(input.assessmentId, input.studentId);
    if (current) {
      if (current.data.detail.sourceId === input.sourceId) return { scoreCents: current.data.scoreCents };
      throw new GradingError('CONFLICT');
    }
    const strategy = strategyFor('QUIZ'); const result = strategy.grade({ questions: input.questions, answers: input.answers });
    const grade = Grade.first({ id: this.runtime.id(), assessmentId: input.assessmentId, courseId: input.courseId, studentId: input.studentId,
      gradedBy: systemActorId, gradedAt: this.runtime.now() }, { ...result, detail: { ...result.detail, sourceId: input.sourceId } }, strategy.origin, 'Calificación automática del intento');
    try { await this.grades.save(grade, null, systemActorId); }
    catch (error) {
      // A concurrent consumer may have stored the same source first: that is the same grade, not an error.
      const stored = error instanceof GradingError && error.code === 'CONFLICT' ? await this.grades.find(input.assessmentId, input.studentId) : null;
      if (stored?.data.detail.sourceId === input.sourceId) return { scoreCents: stored.data.scoreCents };
      throw error;
    }
    this.announce(grade, assessment.title); return { scoreCents: result.scoreCents };
  }
  async scoreOf(assessmentId: string, studentId: string): Promise<number | null> {
    return (await this.grades.find(assessmentId, studentId))?.data.scoreCents ?? null;
  }

  /** A student only sees their own grades of published/closed assessments of a published course they are enrolled in. */
  async myGrades(actorId: string, courseId: string) {
    const course = await this.course(courseId);
    if (await this.directory.role(actorId) !== 'STUDENT' || course.status !== 'PUBLICADO' || !await this.enrollments.has(actorId, courseId)) throw new GradingError('FORBIDDEN');
    const [assessments, grades] = await Promise.all([this.assessments.gradable(courseId), this.grades.forStudent(courseId, actorId)]);
    const visible = grades.filter(grade => assessments.some(assessment => assessment.id === grade.data.assessmentId));
    return { courseId, scale: this.scale, assessments: assessments.map(assessmentView), grades: visible.map(grade => {
      const { reason, ...rest } = gradeView(grade); return rest;
    }), average: averageView(GradingService.average(assessments, visible)) };
  }
}
