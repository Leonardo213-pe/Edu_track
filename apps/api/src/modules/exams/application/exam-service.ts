import { Attempt, ExamError, validVersion, type ExamDefinition } from '../domain/attempt';
import type { AttemptFinalizedEvent } from '../public';
import type { ExamAssessments, ExamCourses, ExamDirectory, ExamEnrollment, ExamGrades, ExamRepository, ExamRuntime } from './ports';

/** CU-03: timed attempt with idempotent autosave, server deadline, finalization and automatic grading through the outbox. */
export class ExamService {
  constructor(private readonly repo: ExamRepository, private readonly assessments: ExamAssessments, private readonly courses: ExamCourses,
    private readonly enrollments: ExamEnrollment, private readonly directory: ExamDirectory, private readonly grades: ExamGrades, private readonly runtime: ExamRuntime) {}

  /** Precondition of CU-03: authenticated student, enrolled in a published course, quiz published (or closed for consulting). */
  private async eligible(studentId: string, assessmentId: string): Promise<ExamDefinition> {
    if (await this.directory.role(studentId) !== 'STUDENT') throw new ExamError('FORBIDDEN');
    const definition = await this.assessments.definition(assessmentId);
    if (!definition || definition.type !== 'QUIZ' || !['PUBLISHED', 'CLOSED'].includes(definition.status)) throw new ExamError('NOT_FOUND');
    const course = await this.courses.describe(definition.courseId);
    if (course?.status !== 'PUBLICADO' || !await this.enrollments.has(studentId, definition.courseId)) throw new ExamError('FORBIDDEN');
    return definition;
  }
  /** A deadline reached without a call to finalize is closed as soon as anyone looks at the attempt (the sweeper does it too). */
  private async current(attempt: Attempt, now: Date): Promise<Attempt> {
    return attempt.data.status === 'IN_PROGRESS' && !attempt.isOpen(now) ? this.repo.finalize(attempt.data.id) : attempt;
  }
  private async owned(studentId: string, attemptId: string): Promise<Attempt> {
    const attempt = await this.repo.find(attemptId); if (!attempt) throw new ExamError('NOT_FOUND'); attempt.ownedBy(studentId); return attempt;
  }
  private summary(attempt: Attempt, now: Date) {
    const { questions, ...data } = attempt.data;
    return { ...data, questionCount: questions.length, remainingSeconds: attempt.remainingSeconds(now) };
  }

  async status(studentId: string, assessmentId: string) {
    const definition = await this.eligible(studentId, assessmentId); const now = await this.repo.now();
    const found = await this.repo.findByStudent(assessmentId, studentId); const attempt = found ? await this.current(found, now) : null;
    const score = attempt && attempt.data.status !== 'IN_PROGRESS' ? await this.grades.scoreOf(assessmentId, studentId) : null;
    return { assessment: { id: definition.id, title: definition.title, status: definition.status, dueAt: definition.dueAt, durationMinutes: definition.durationMinutes,
      questionCount: definition.questionCount }, serverTime: now.toISOString(),
      canStart: !attempt && definition.status === 'PUBLISHED' && now.getTime() < new Date(definition.dueAt).getTime(),
      attempt: attempt ? this.summary(attempt, now) : null, score: score === null ? null : score / 100 };
  }
  async start(studentId: string, assessmentId: string) {
    const definition = await this.eligible(studentId, assessmentId); const now = await this.repo.now();
    const existing = await this.repo.findByStudent(assessmentId, studentId);
    if (existing) return this.view(studentId, existing.data.id);
    const attempt = Attempt.start(this.runtime.id(), definition, studentId, await this.assessments.draw(assessmentId), now);
    return this.view(studentId, (await this.repo.create(attempt)).data.id);
  }
  /** Reconnection (A1): questions, the last confirmed answers with their versions and the server clock. */
  async view(studentId: string, attemptId: string) {
    const now = await this.repo.now(); const attempt = await this.current(await this.owned(studentId, attemptId), now);
    const answers = await this.repo.answers(attemptId);
    const score = attempt.data.status !== 'IN_PROGRESS' ? await this.grades.scoreOf(attempt.data.assessmentId, studentId) : null;
    return { ...this.summary(attempt, now), serverTime: now.toISOString(), questions: attempt.data.questions,
      answers: answers.map(({ questionId, optionIds, version }) => ({ questionId, optionIds, version })), score: score === null ? null : score / 100 };
  }
  async saveAnswer(studentId: string, attemptId: string, questionId: string, optionIds: unknown, version: unknown) {
    const attempt = await this.owned(studentId, attemptId);
    const selection = attempt.validateAnswer(questionId, optionIds); const checked = validVersion(version);
    if (attempt.data.status !== 'IN_PROGRESS') throw new ExamError('ATTEMPT_CLOSED');
    return this.repo.saveAnswer(attemptId, questionId, selection, checked);
  }
  async finalize(studentId: string, attemptId: string) {
    await this.owned(studentId, attemptId); await this.repo.finalize(attemptId); return this.view(studentId, attemptId);
  }
  /** Teacher responsible or admin follows the attempts of an assessment (no answers). */
  async attempts(actorId: string, assessmentId: string) {
    const definition = await this.assessments.definition(assessmentId); if (!definition) throw new ExamError('NOT_FOUND');
    const course = await this.courses.describe(definition.courseId); const role = await this.directory.role(actorId);
    if (role !== 'ADMIN' && !(role === 'TEACHER' && course?.teacherId === actorId)) throw new ExamError('FORBIDDEN');
    const now = await this.repo.now(); const rows = await this.repo.forAssessment(assessmentId);
    const names = await this.directory.names(rows.map(row => row.attempt.data.studentId));
    const result = [];
    for (const row of rows) {
      const data = row.attempt.data; const score = data.status === 'IN_PROGRESS' ? null : await this.grades.scoreOf(assessmentId, data.studentId);
      result.push({ ...this.summary(row.attempt, now), displayName: names.get(data.studentId) ?? data.studentId, answered: row.answered, score: score === null ? null : score / 100 });
    }
    return result.sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));
  }

  /** Outbox consumer: grades the drawn questions with the automatic strategy. Idempotent, so retries never duplicate. */
  async handleFinalized(event: Pick<AttemptFinalizedEvent, 'attemptId'>): Promise<void> {
    const attempt = await this.repo.find(event.attemptId);
    if (!attempt || attempt.data.status === 'IN_PROGRESS') throw new ExamError('NOT_FOUND');
    const drawn = new Set(attempt.data.questions.map(question => question.questionId));
    const key = (await this.assessments.answerKey(attempt.data.assessmentId)).filter(item => drawn.has(item.questionId));
    if (key.length !== drawn.size) throw new ExamError('NOT_FOUND');
    const answers = Object.fromEntries((await this.repo.answers(attempt.data.id)).map(answer => [answer.questionId, [...answer.optionIds]]));
    await this.grades.recordAutomatic({ assessmentId: attempt.data.assessmentId, courseId: attempt.data.courseId, studentId: attempt.data.studentId,
      sourceId: attempt.data.id, questions: key, answers });
  }
  expire(limit = 100): Promise<number> { return this.repo.expireDue(limit); }
}
