import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './generated/client';
import { Attempt, ExamError, type AttemptData, type AttemptQuestion, type SavedAnswer } from '../../domain/attempt';
import type { AttemptSummary, ExamRepository, SaveResult } from '../../application/ports';
import { ATTEMPT_FINALIZED } from '../../public';

type AttemptRow = Prisma.ExamAttemptGetPayload<object>;
interface RawAttempt { id: string; assessmentId: string; courseId: string; studentId: string; status: string; startedAt: Date; expiresAt: Date;
  finalizedAt: Date | null; finalizedBy: string | null; questions: unknown }

export class PrismaExamRepository implements ExamRepository {
  readonly db: PrismaClient;
  /** Exam traffic gets its own pool so slow background work never starves answer saving (EAC-01). */
  constructor(url: string, poolSize = 20) {
    this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: poolSize, connectionTimeoutMillis: 5000 }) });
  }
  private map(row: AttemptRow | RawAttempt): Attempt {
    return Attempt.restore({ id: row.id, assessmentId: row.assessmentId, courseId: row.courseId, studentId: row.studentId, status: row.status as AttemptData['status'],
      startedAt: row.startedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), finalizedAt: row.finalizedAt?.toISOString() ?? null,
      finalizedBy: row.finalizedBy as AttemptData['finalizedBy'], questions: row.questions as AttemptQuestion[] });
  }
  async now(): Promise<Date> {
    const [row] = await this.db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`; return row!.now;
  }
  async find(id: string) { const row = await this.db.examAttempt.findUnique({ where: { id } }); return row ? this.map(row) : null; }
  async findByStudent(assessmentId: string, studentId: string) {
    const row = await this.db.examAttempt.findUnique({ where: { assessmentId_studentId: { assessmentId, studentId } } }); return row ? this.map(row) : null;
  }
  async forAssessment(assessmentId: string): Promise<AttemptSummary[]> {
    const rows = await this.db.examAttempt.findMany({ where: { assessmentId }, include: { _count: { select: { answers: true } } }, orderBy: { startedAt: 'asc' } });
    return rows.map(({ _count, ...row }) => ({ attempt: this.map(row), answered: _count.answers }));
  }
  async answers(attemptId: string): Promise<SavedAnswer[]> {
    const rows = await this.db.examAnswer.findMany({ where: { attemptId }, orderBy: { questionId: 'asc' } });
    return rows.map(row => ({ questionId: row.questionId, optionIds: row.optionIds as string[], version: Number(row.version), savedAt: row.savedAt.toISOString() }));
  }
  async create(attempt: Attempt): Promise<Attempt> {
    const data = attempt.data;
    try {
      await this.db.examAttempt.create({ data: { ...data, startedAt: new Date(data.startedAt), expiresAt: new Date(data.expiresAt), finalizedAt: null, finalizedBy: null,
        questions: data.questions as unknown as Prisma.InputJsonValue } });
      return attempt;
    } catch (error) {
      // Two simultaneous "start" requests: the unique (assessment, student) keeps one attempt; both callers get it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return (await this.findByStudent(data.assessmentId, data.studentId))!;
      throw error;
    }
  }
  async saveAnswer(attemptId: string, questionId: string, optionIds: string[], version: number): Promise<SaveResult> {
    return this.db.$transaction(async tx => {
      // Shared lock on the own attempt only: saves of different students never wait for each other; finalize waits for in-flight saves.
      const [attempt] = await tx.$queryRaw<{ open: boolean }[]>`
        SELECT (status = 'IN_PROGRESS' AND "expiresAt" > clock_timestamp()) AS open FROM exams.attempts WHERE id = ${attemptId}::uuid FOR SHARE`;
      if (!attempt) throw new ExamError('NOT_FOUND');
      if (!attempt.open) throw new ExamError('ATTEMPT_CLOSED');
      const json = JSON.stringify(optionIds);
      type Row = { version: bigint; optionIds: string[]; savedAt: Date };
      const [written] = await tx.$queryRaw<Row[]>`
        INSERT INTO exams.answers ("attemptId", "questionId", "optionIds", version, "savedAt")
        VALUES (${attemptId}::uuid, ${questionId}::uuid, ${json}::jsonb, ${version}, clock_timestamp())
        ON CONFLICT ("attemptId", "questionId") DO UPDATE SET "optionIds" = EXCLUDED."optionIds", version = EXCLUDED.version, "savedAt" = EXCLUDED."savedAt"
        WHERE exams.answers.version < EXCLUDED.version
        RETURNING version, "optionIds", "savedAt"`;
      // Not written: an equal or newer version is stored. Read it in a new statement (fresh snapshot): under concurrency the
      // row may have been committed by a parallel retry after this statement's snapshot, which ON CONFLICT already saw.
      const stored = written ?? (await tx.$queryRaw<Row[]>`
        SELECT version, "optionIds", "savedAt" FROM exams.answers WHERE "attemptId" = ${attemptId}::uuid AND "questionId" = ${questionId}::uuid`)[0];
      if (!stored) throw new ExamError('ATTEMPT_CLOSED');
      return { accepted: !!written, questionId, optionIds: stored.optionIds, version: Number(stored.version), savedAt: stored.savedAt.toISOString() };
    });
  }
  private event(attempt: RawAttempt) {
    const eventId = randomUUID();
    return { id: eventId, type: ATTEMPT_FINALIZED, aggregateId: attempt.id, payload: { eventId, occurredAt: (attempt.finalizedAt ?? new Date()).toISOString(), schemaVersion: 1,
      aggregateId: attempt.id, correlationId: attempt.id, attemptId: attempt.id, assessmentId: attempt.assessmentId, courseId: attempt.courseId,
      studentId: attempt.studentId, reason: attempt.finalizedBy }, createdAt: new Date(), availableAt: new Date() };
  }
  async finalize(attemptId: string): Promise<Attempt> {
    return this.db.$transaction(async tx => {
      const [updated] = await tx.$queryRaw<RawAttempt[]>`
        UPDATE exams.attempts SET
          status = CASE WHEN clock_timestamp() >= "expiresAt" THEN 'EXPIRED' ELSE 'SUBMITTED' END,
          "finalizedBy" = CASE WHEN clock_timestamp() >= "expiresAt" THEN 'TIMEOUT' ELSE 'STUDENT' END,
          "finalizedAt" = LEAST(clock_timestamp(), "expiresAt")
        WHERE id = ${attemptId}::uuid AND status = 'IN_PROGRESS' RETURNING *`;
      if (updated) {
        // Finalization and its event commit together: the grade can never be lost if the process stops right after.
        const event = this.event(updated); await tx.examOutbox.create({ data: { ...event, payload: event.payload as Prisma.InputJsonValue } });
        return this.map(updated);
      }
      const current = await tx.examAttempt.findUnique({ where: { id: attemptId } }); if (!current) throw new ExamError('NOT_FOUND');
      return this.map(current); // already finalized: idempotent
    });
  }
  async expireDue(limit: number): Promise<number> {
    return this.db.$transaction(async tx => {
      const expired = await tx.$queryRaw<RawAttempt[]>`
        UPDATE exams.attempts SET status = 'EXPIRED', "finalizedBy" = 'TIMEOUT', "finalizedAt" = "expiresAt"
        WHERE id IN (SELECT id FROM exams.attempts WHERE status = 'IN_PROGRESS' AND "expiresAt" <= clock_timestamp()
          ORDER BY "expiresAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)
        RETURNING *`;
      if (expired.length) await tx.examOutbox.createMany({ data: expired.map(row => { const event = this.event(row); return { ...event, payload: event.payload as Prisma.InputJsonValue }; }) });
      return expired.length;
    });
  }

  /** Claims one due event (SKIP LOCKED: one replica per event), runs the handler and records success or a retry with backoff. */
  async processNext(handler: (payload: Record<string, unknown>) => Promise<void>): Promise<boolean> {
    return this.db.$transaction(async tx => {
      const [event] = await tx.$queryRaw<{ id: string; payload: Record<string, unknown>; attempts: number }[]>`
        SELECT id, payload, attempts FROM exams.outbox WHERE "processedAt" IS NULL AND "availableAt" <= clock_timestamp() AND attempts < 10
        ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!event) return false;
      try {
        await handler(event.payload);
        await tx.examOutbox.update({ where: { id: event.id }, data: { processedAt: new Date(), lastError: null } });
      } catch (error) {
        const code = error instanceof Error ? error.message.slice(0, 200) : 'UNKNOWN';
        await tx.examOutbox.update({ where: { id: event.id }, data: { attempts: event.attempts + 1, lastError: code,
          availableAt: new Date(Date.now() + Math.min(300_000, 2_000 * 2 ** event.attempts)) } });
      }
      return true;
    }, { timeout: 30000 });
  }
  async ping(): Promise<void> { await this.db.$queryRaw`SELECT 1`; }
  async onModuleDestroy() { await this.db.$disconnect(); }
}
