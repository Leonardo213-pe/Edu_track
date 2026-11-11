import { PrismaPg } from '@prisma/adapter-pg';
import { capPool } from '../../../../platform/persistence/pool-size';
import { PrismaClient, Prisma } from './generated/client';
import { AUDIT_ACTOR_SETTING } from '../../../audit/public';
import { Assessment, type AssessmentData, type Criterion, type SnapshotQuestion } from '../../domain/assessment';
import { AssessmentError, Question, type QuestionOption, type QuestionType } from '../../domain/question';
import type { AssessmentRepository, Bank } from '../../application/ports';

type AssessmentRow = Prisma.AssessmentGetPayload<object>;
type QuestionRow = Prisma.QuestionGetPayload<object>;
export class PrismaAssessmentRepository implements AssessmentRepository {
  private readonly db: PrismaClient;
  constructor(url: string) { this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: capPool(5), connectionTimeoutMillis: 5000 }) }); }

  private question(row: QuestionRow): Question {
    return Question.restore({ id: row.id, bankId: row.bankId, type: row.type as QuestionType, statement: row.statement, pointsCents: row.pointsCents,
      options: row.options as unknown as QuestionOption[], active: row.active, version: row.version, createdAt: row.createdAt.toISOString() });
  }
  private assessment(row: AssessmentRow): Assessment {
    return Assessment.restore({ ...row, type: row.type as AssessmentData['type'], status: row.status as AssessmentData['status'],
      criteria: row.criteria as unknown as Criterion[], dueAt: row.dueAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() });
  }
  private row(data: AssessmentData) {
    const { id, courseId, createdAt, ...rest } = data;
    return { ...rest, criteria: rest.criteria as unknown as Prisma.InputJsonValue, dueAt: new Date(rest.dueAt), publishedAt: rest.publishedAt ? new Date(rest.publishedAt) : null };
  }
  private translate(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AssessmentError('CONFLICT');
    throw error;
  }

  async banks(courseId: string) {
    const rows = await this.db.questionBank.findMany({ where: { courseId }, include: { questions: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'asc' } });
    return rows.map(({ questions, createdAt, ...bank }) => ({ ...bank, createdAt: createdAt.toISOString(), questions: questions.map(row => this.question(row)) }));
  }
  async findBank(id: string): Promise<Bank | null> {
    const row = await this.db.questionBank.findUnique({ where: { id } }); return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
  }
  async createBank(bank: Bank) {
    try { await this.db.questionBank.create({ data: { ...bank, createdAt: new Date(bank.createdAt) } }); } catch (error) { this.translate(error); }
  }
  async findQuestion(id: string) { const row = await this.db.question.findUnique({ where: { id } }); return row ? this.question(row) : null; }
  async bankQuestions(bankId: string) {
    return (await this.db.question.findMany({ where: { bankId }, orderBy: { createdAt: 'asc' } })).map(row => this.question(row));
  }
  async saveQuestion(question: Question, expectedVersion: number | null) {
    const { id, bankId, createdAt, options, ...rest } = question.data;
    const data = { ...rest, options: options as unknown as Prisma.InputJsonValue };
    if (expectedVersion === null) { await this.db.question.create({ data: { ...data, id, bankId, createdAt: new Date(createdAt) } }); return; }
    const result = await this.db.question.updateMany({ where: { id, version: expectedVersion }, data });
    if (result.count !== 1) throw new AssessmentError('CONFLICT');
  }

  async list(courseId: string) {
    return (await this.db.assessment.findMany({ where: { courseId }, orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }] })).map(row => this.assessment(row));
  }
  async find(id: string) { const row = await this.db.assessment.findUnique({ where: { id } }); return row ? this.assessment(row) : null; }
  private async lock(tx: Prisma.TransactionClient, courseId: string) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${courseId}, 53))::text`;
  }
  async create(assessment: Assessment, decide: (siblings: Assessment[]) => void) {
    const data = assessment.snapshot();
    await this.db.$transaction(async tx => {
      await this.lock(tx, data.courseId);
      decide((await tx.assessment.findMany({ where: { courseId: data.courseId } })).map(row => this.assessment(row)));
      await tx.assessment.create({ data: { ...this.row(data), id: data.id, courseId: data.courseId, createdAt: new Date(data.createdAt) } });
    });
  }
  async mutate(id: string, revision: number, actorId: string, work: (assessment: Assessment, siblings: Assessment[]) => Promise<SnapshotQuestion[] | void>) {
    const current = await this.db.assessment.findUnique({ where: { id }, select: { courseId: true } });
    if (!current) throw new AssessmentError('NOT_FOUND');
    return this.db.$transaction(async tx => {
      await this.lock(tx, current.courseId);
      const rows = (await tx.assessment.findMany({ where: { courseId: current.courseId } })).map(row => this.assessment(row));
      const target = rows.find(item => item.data.id === id);
      if (!target) throw new AssessmentError('NOT_FOUND');
      if (target.data.revision !== revision) throw new AssessmentError('CONFLICT');
      const snapshot = await work(target, rows.filter(item => item !== target)); target.advanceRevision();
      // Declares who changes a published assessment; the audit trigger fails the transaction without it.
      await tx.$queryRaw`SELECT set_config(${AUDIT_ACTOR_SETTING}, ${actorId}, true)`;
      await tx.assessment.update({ where: { id }, data: this.row(target.snapshot()) });
      if (snapshot?.length) await tx.snapshotQuestion.createMany({ data: snapshot.map(question => ({ ...question, assessmentId: id,
        options: question.options as unknown as Prisma.InputJsonValue })) });
      return target;
    }, { timeout: 20000 });
  }
  async remove(id: string, revision: number) {
    const result = await this.db.assessment.deleteMany({ where: { id, revision, status: 'DRAFT' } });
    if (result.count !== 1) throw new AssessmentError('CONFLICT');
  }
  async snapshot(id: string): Promise<SnapshotQuestion[]> {
    const rows = await this.db.snapshotQuestion.findMany({ where: { assessmentId: id }, orderBy: { position: 'asc' } });
    return rows.map(row => ({ questionId: row.questionId, position: row.position, type: row.type as QuestionType, statement: row.statement,
      pointsCents: row.pointsCents, options: row.options as unknown as QuestionOption[] }));
  }
  async dueBetween(from: string, to: string) {
    return (await this.db.assessment.findMany({ where: { status: 'PUBLISHED', dueAt: { gte: new Date(from), lt: new Date(to) } } })).map(row => this.assessment(row));
  }
  async onModuleDestroy() { await this.db.$disconnect(); }
}
