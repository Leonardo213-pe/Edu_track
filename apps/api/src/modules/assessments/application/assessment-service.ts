import { Assessment, draw, ensureWeights, type AssessmentInput, type SnapshotQuestion } from '../domain/assessment';
import { AssessmentError, Question, text, type QuestionInput } from '../domain/question';
import type { AnswerKeyItem, AssessmentCatalog, DrawnQuestion, ExamDefinition, GradableAssessment } from '../public';
import type { AssessmentActor, AssessmentCourses, AssessmentDirectory, AssessmentEnrollment, AssessmentRepository, AssessmentRuntime, CourseSummary } from './ports';

/** CU-07 (question bank) and assessment definition/publication for CAR-04. */
export class AssessmentService implements AssessmentCatalog {
  constructor(private readonly repo: AssessmentRepository, private readonly courses: AssessmentCourses, private readonly directory: AssessmentDirectory,
    private readonly enrollments: AssessmentEnrollment, private readonly runtime: AssessmentRuntime) {}

  private async actor(id: string): Promise<AssessmentActor> {
    const actor = await this.directory.find(id); if (!actor) throw new AssessmentError('FORBIDDEN'); return actor;
  }
  private async course(courseId: string): Promise<CourseSummary> {
    const course = await this.courses.describe(courseId); if (!course) throw new AssessmentError('NOT_FOUND'); return course;
  }
  /** Only the responsible teacher or an administrator designs banks and assessments of a course. */
  private async manager(actorId: string, courseId: string): Promise<{ actor: AssessmentActor; course: CourseSummary }> {
    const actor = await this.actor(actorId); const course = await this.course(courseId);
    if (actor.role !== 'ADMIN' && !(actor.role === 'TEACHER' && actor.id === course.teacherId)) throw new AssessmentError('FORBIDDEN');
    return { actor, course };
  }
  private async load(id: string): Promise<Assessment> {
    const assessment = await this.repo.find(id); if (!assessment) throw new AssessmentError('NOT_FOUND'); return assessment;
  }

  async banks(actorId: string, courseId: string) {
    await this.manager(actorId, courseId);
    return (await this.repo.banks(courseId)).map(bank => ({ ...bank, questions: bank.questions.map(question => question.data) }));
  }
  async createBank(actorId: string, courseId: string, name: string) {
    await this.manager(actorId, courseId);
    await this.repo.createBank({ id: this.runtime.id(), courseId, name: text(name, 160), createdAt: this.runtime.now() });
    return this.banks(actorId, courseId);
  }
  async addQuestion(actorId: string, bankId: string, input: QuestionInput) {
    const bank = await this.repo.findBank(bankId); if (!bank) throw new AssessmentError('NOT_FOUND');
    await this.manager(actorId, bank.courseId);
    const question = Question.create(this.runtime.id(), bankId, input, () => this.runtime.id(), this.runtime.now());
    await this.repo.saveQuestion(question, null); return question.data;
  }
  /** Bank questions can always be improved: published assessments keep their frozen snapshot. */
  async editQuestion(actorId: string, questionId: string, version: number, input: QuestionInput) {
    const question = await this.repo.findQuestion(questionId); if (!question) throw new AssessmentError('NOT_FOUND');
    const bank = (await this.repo.findBank(question.data.bankId))!; await this.manager(actorId, bank.courseId);
    if (question.data.version !== version) throw new AssessmentError('CONFLICT');
    const next = question.revise(input, () => this.runtime.id()); await this.repo.saveQuestion(next, version); return next.data;
  }

  async list(actorId: string, courseId: string) {
    const actor = await this.actor(actorId); const course = await this.course(courseId); const assessments = await this.repo.list(courseId);
    const staff = actor.role === 'ADMIN' || actor.role === 'INSTRUCTIONAL_DESIGNER' || (actor.role === 'TEACHER' && actor.id === course.teacherId);
    if (staff) return assessments.map(item => item.snapshot());
    if (actor.role !== 'STUDENT' || course.status !== 'PUBLICADO' || !await this.enrollments.has(actor.id, courseId)) throw new AssessmentError('FORBIDDEN');
    return assessments.filter(item => item.visibleToStudents()).map(item => item.publicView());
  }
  private async bankOf(courseId: string, input: AssessmentInput): Promise<void> {
    if (input.type !== 'QUIZ') return;
    const bank = input.bankId ? await this.repo.findBank(input.bankId) : null;
    if (!bank || bank.courseId !== courseId) throw new AssessmentError('INVALID_INPUT');
  }
  async create(actorId: string, courseId: string, input: AssessmentInput) {
    await this.manager(actorId, courseId); await this.bankOf(courseId, input);
    const assessment = Assessment.create(this.runtime.id(), courseId, input, () => this.runtime.id(), this.runtime.now());
    await this.repo.create(assessment, siblings => ensureWeights(siblings, assessment));
    return assessment.snapshot();
  }
  private async change(actorId: string, id: string, revision: number,
    work: (assessment: Assessment, siblings: Assessment[], course: CourseSummary) => Promise<SnapshotQuestion[] | void>) {
    if (!Number.isInteger(revision) || revision < 0) throw new AssessmentError('INVALID_INPUT');
    const current = await this.load(id); const { course } = await this.manager(actorId, current.data.courseId);
    return (await this.repo.mutate(id, revision, actorId, (assessment, siblings) => work(assessment, siblings, course))).snapshot();
  }
  edit(actorId: string, id: string, revision: number, input: AssessmentInput) {
    return this.change(actorId, id, revision, async (assessment, siblings) => {
      if (input.type === 'QUIZ' && input.bankId !== assessment.data.bankId) await this.bankOf(assessment.data.courseId, input);
      assessment.edit(input, () => this.runtime.id()); ensureWeights(siblings, assessment);
    });
  }
  publish(actorId: string, id: string, revision: number) {
    return this.change(actorId, id, revision, async (assessment, _siblings, course) => {
      const pool = assessment.data.bankId ? (await this.repo.bankQuestions(assessment.data.bankId)).map(question => question.data) : [];
      return assessment.publish(pool, course.status === 'PUBLICADO', this.runtime.now());
    });
  }
  close(actorId: string, id: string, revision: number) {
    return this.change(actorId, id, revision, async assessment => { assessment.close(); });
  }
  async remove(actorId: string, id: string, revision: number) {
    const assessment = await this.load(id); await this.manager(actorId, assessment.data.courseId); assessment.removable();
    await this.repo.remove(id, revision);
  }
  /** Teacher preview of one random draw (answers included); students never reach it. Phase 5 draws per attempt. */
  async preview(actorId: string, id: string) {
    const assessment = await this.load(id); await this.manager(actorId, assessment.data.courseId);
    if (assessment.data.type !== 'QUIZ') throw new AssessmentError('INVALID_INPUT');
    const pool: SnapshotQuestion[] = assessment.data.status === 'DRAFT'
      ? (await this.repo.bankQuestions(assessment.data.bankId!)).filter(question => question.data.active).map((question, position) => ({
        questionId: question.data.id, position, type: question.data.type, statement: question.data.statement, pointsCents: question.data.pointsCents, options: question.data.options }))
      : await this.repo.snapshot(id);
    return { assessmentId: id, poolSize: pool.length, questions: draw(pool, assessment.data.questionCount!, () => this.runtime.random()) };
  }

  private gradableView(assessment: Assessment): GradableAssessment {
    const data = assessment.data;
    return { id: data.id, courseId: data.courseId, title: data.title, type: data.type, weightBp: data.weightBp,
      status: data.status as 'PUBLISHED' | 'CLOSED', dueAt: data.dueAt, criteria: data.criteria };
  }
  async gradable(courseId: string): Promise<GradableAssessment[]> {
    return (await this.repo.list(courseId)).filter(item => item.acceptsGrades()).map(item => this.gradableView(item));
  }
  async findGradable(id: string): Promise<GradableAssessment | null> {
    const assessment = await this.repo.find(id); return assessment?.acceptsGrades() ? this.gradableView(assessment) : null;
  }
  async examDefinition(id: string): Promise<ExamDefinition | null> {
    const assessment = await this.repo.find(id); if (!assessment) return null;
    const { courseId, title, status, type, dueAt, durationMinutes, questionCount } = assessment.data;
    return { id, courseId, title, status, type, dueAt, durationMinutes, questionCount };
  }
  async drawForAttempt(id: string): Promise<DrawnQuestion[]> {
    const assessment = await this.load(id);
    if (assessment.data.type !== 'QUIZ' || assessment.data.status !== 'PUBLISHED') throw new AssessmentError('INVALID_STATE');
    return draw(await this.repo.snapshot(id), assessment.data.questionCount!, () => this.runtime.random()).map((question, position) => ({
      questionId: question.questionId, position, type: question.type, statement: question.statement, pointsCents: question.pointsCents,
      options: question.options.map(option => ({ id: option.id, text: option.text })) }));
  }
  async dueBetween(from: string, to: string) {
    return (await this.repo.dueBetween(from, to)).map(item => ({ id: item.data.id, courseId: item.data.courseId, title: item.data.title, dueAt: item.data.dueAt }));
  }
  async answerKey(id: string): Promise<AnswerKeyItem[]> {
    return (await this.repo.snapshot(id)).map(question => ({ questionId: question.questionId, pointsCents: question.pointsCents,
      correctOptionIds: question.options.filter(option => option.correct).map(option => option.id) }));
  }
}
