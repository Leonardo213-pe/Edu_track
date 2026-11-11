import { PrismaPg } from '@prisma/adapter-pg';
import { capPool } from '../../../../platform/persistence/pool-size';
import { PrismaClient, type Prisma } from './generated/client';
import type { FileRecord, ReceiveCommand, SubmissionRecord, SubmissionRepository } from '../../application/ports';
import type { SubmissionEvents, SubmissionReceived, SubmissionText } from '../../public';

type FileRow = { id: string; submissionId: string; version: number; storageKey: string; filename: string; mimeType: string; size: number; sha256: string; receivedAt: Date };
const toFile = (row: FileRow): FileRecord => ({ id: row.id, submissionId: row.submissionId, version: row.version, storageKey: row.storageKey, filename: row.filename,
  mimeType: row.mimeType, size: row.size, sha256: row.sha256, receivedAt: row.receivedAt.toISOString() });
const fileColumns = { id: true, submissionId: true, version: true, storageKey: true, filename: true, mimeType: true, size: true, sha256: true, receivedAt: true } as const;

export class PrismaSubmissionRepository implements SubmissionRepository, SubmissionEvents {
  private readonly db: PrismaClient;
  constructor(url: string) { this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: capPool(5), connectionTimeoutMillis: 5000 }) }); }

  private async record(row: { id: string; assessmentId: string; courseId: string; studentId: string; version: number; currentFileId: string; firstSubmittedAt: Date; updatedAt: Date },
    client: Pick<PrismaClient, 'submissionFile'> = this.db): Promise<SubmissionRecord> {
    const current = await client.submissionFile.findUniqueOrThrow({ where: { id: row.currentFileId }, select: fileColumns });
    return { ...row, firstSubmittedAt: row.firstSubmittedAt.toISOString(), updatedAt: row.updatedAt.toISOString(), current: toFile(current) };
  }
  async receive(command: ReceiveCommand): Promise<SubmissionRecord | null> {
    return this.db.$transaction(async tx => {
      // One writer per student and assignment; the deadline is decided with the database clock (never the client's).
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${command.assessmentId}:${command.studentId}`}, 71))::text`;
      const [clock] = await tx.$queryRaw<{ now: Date; open: boolean }[]>`SELECT clock_timestamp() AS now, clock_timestamp() <= ${command.dueAt}::timestamptz AS open`;
      if (!clock?.open) return null;
      const at = clock.now;
      const existing = await tx.submission.findUnique({ where: { assessmentId_studentId: { assessmentId: command.assessmentId, studentId: command.studentId } } });
      const submissionId = existing?.id ?? command.submissionId; const version = (existing?.version ?? 0) + 1;
      if (!existing) await tx.submission.create({ data: { id: submissionId, assessmentId: command.assessmentId, courseId: command.courseId, studentId: command.studentId,
        version, currentFileId: command.fileId, firstSubmittedAt: at, updatedAt: at } });
      await tx.submissionFile.create({ data: { id: command.fileId, submissionId, version, storageKey: command.file.key, filename: command.file.filename,
        mimeType: command.file.mimeType, size: command.file.size, sha256: command.file.sha256, textContent: command.text, receivedAt: at } });
      const row = existing ? await tx.submission.update({ where: { id: submissionId }, data: { version, currentFileId: command.fileId, updatedAt: at } })
        : await tx.submission.findUniqueOrThrow({ where: { id: submissionId } });
      const event: SubmissionReceived = { type: 'SubmissionReceived.v1', submissionId, fileId: command.fileId, version, assessmentId: command.assessmentId,
        courseId: command.courseId, studentId: command.studentId };
      await tx.submissionOutbox.create({ data: { id: command.eventId, type: event.type, aggregateId: submissionId, payload: event as unknown as Prisma.InputJsonValue,
        createdAt: at, availableAt: at } });
      return this.record(row, tx);
    }, { timeout: 20000 });
  }
  async find(assessmentId: string, studentId: string): Promise<SubmissionRecord | null> {
    const row = await this.db.submission.findUnique({ where: { assessmentId_studentId: { assessmentId, studentId } } });
    return row ? this.record(row) : null;
  }
  async forAssessment(assessmentId: string): Promise<SubmissionRecord[]> {
    const rows = await this.db.submission.findMany({ where: { assessmentId } });
    const files = new Map((await this.db.submissionFile.findMany({ where: { id: { in: rows.map(row => row.currentFileId) } }, select: fileColumns })).map(file => [file.id, file]));
    return rows.map(row => ({ ...row, firstSubmittedAt: row.firstSubmittedAt.toISOString(), updatedAt: row.updatedAt.toISOString(), current: toFile(files.get(row.currentFileId)!) }));
  }
  async history(submissionId: string): Promise<FileRecord[]> {
    return (await this.db.submissionFile.findMany({ where: { submissionId }, orderBy: { version: 'desc' }, select: fileColumns })).map(toFile);
  }
  async file(fileId: string) {
    const file = await this.db.submissionFile.findUnique({ where: { id: fileId }, select: fileColumns }); if (!file) return null;
    const submission = await this.db.submission.findUniqueOrThrow({ where: { id: file.submissionId } });
    return { ...toFile(file), assessmentId: submission.assessmentId, courseId: submission.courseId, studentId: submission.studentId };
  }

  /** Claims one due event (SKIP LOCKED: one replica per event), runs the handler and records success or a retry with backoff. */
  async processNext(handler: (event: SubmissionReceived) => Promise<void>): Promise<boolean> {
    return this.db.$transaction(async tx => {
      const [event] = await tx.$queryRaw<{ id: string; payload: SubmissionReceived; attempts: number }[]>`
        SELECT id, payload, attempts FROM submissions.outbox WHERE "processedAt" IS NULL AND "availableAt" <= clock_timestamp() AND attempts < 10
        ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!event) return false;
      try {
        await handler(event.payload);
        await tx.submissionOutbox.update({ where: { id: event.id }, data: { processedAt: new Date(), lastError: null } });
      } catch (error) {
        await tx.submissionOutbox.update({ where: { id: event.id }, data: { attempts: event.attempts + 1, lastError: error instanceof Error ? error.message.slice(0, 200) : 'UNKNOWN',
          availableAt: new Date(Date.now() + Math.min(300_000, 2_000 * 2 ** event.attempts)) } });
      }
      return true;
    }, { timeout: 30000 });
  }
  async corpusFor(fileId: string): Promise<{ document: SubmissionText; others: SubmissionText[] } | null> {
    const file = await this.db.submissionFile.findUnique({ where: { id: fileId }, select: { id: true, submissionId: true, textContent: true } }); if (!file) return null;
    const submission = await this.db.submission.findUniqueOrThrow({ where: { id: file.submissionId } });
    const others = await this.db.submission.findMany({ where: { courseId: submission.courseId, studentId: { not: submission.studentId } }, select: { id: true, studentId: true, currentFileId: true } });
    const texts = new Map((await this.db.submissionFile.findMany({ where: { id: { in: others.map(item => item.currentFileId) } }, select: { id: true, textContent: true } })).map(item => [item.id, item.textContent]));
    return { document: { fileId: file.id, submissionId: file.submissionId, studentId: submission.studentId, text: file.textContent },
      others: others.map(item => ({ fileId: item.currentFileId, submissionId: item.id, studentId: item.studentId, text: texts.get(item.currentFileId) ?? null })) };
  }
  async backlog(): Promise<{ pending: number; failing: number; oldestPendingSeconds: number | null }> {
    const [row] = await this.db.$queryRaw<{ pending: number; failing: number; oldest: number | null }[]>`
      SELECT count(*)::int AS pending, count(*) FILTER (WHERE attempts > 0)::int AS failing,
        EXTRACT(EPOCH FROM clock_timestamp() - min("createdAt"))::float8 AS oldest
      FROM submissions.outbox WHERE "processedAt" IS NULL`;
    return { pending: row?.pending ?? 0, failing: row?.failing ?? 0, oldestPendingSeconds: row?.oldest === null || row?.oldest === undefined ? null : Math.round(row.oldest) };
  }
  async onModuleDestroy() { await this.db.$disconnect(); }
}
