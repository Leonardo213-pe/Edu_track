import { PrismaPg } from '@prisma/adapter-pg';
import { capPool } from '../../../../platform/persistence/pool-size';
import { PrismaClient } from './generated/client';
import type { Reconciliation, RosterEntry } from '../../domain/enrollment';
import type { EnrollmentRepository, EnrollmentRun, LinkedSection, RegistrySyncRepository, SyncRun } from '../../application/ports';
import type { SyncTotals } from '../../domain/registry';

export class PrismaEnrollmentRepository implements EnrollmentRepository, RegistrySyncRepository {
  private readonly db: PrismaClient;
  constructor(url: string) { this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: capPool(5), connectionTimeoutMillis: 5000 }) }); }

  async isEnrolled(studentId: string, courseId: string): Promise<boolean> {
    return !!(await this.db.enrollment.findFirst({ where: { studentId, courseId, active: true }, select: { studentId: true } }));
  }
  async activeCourses(studentId: string): Promise<string[]> {
    return (await this.db.enrollment.findMany({ where: { studentId, active: true }, select: { courseId: true } })).map(row => row.courseId);
  }
  async roster(courseId: string): Promise<RosterEntry[]> {
    return this.db.enrollment.findMany({ where: { courseId }, select: { studentId: true, active: true } });
  }
  async reconcile(courseId: string, decide: (current: RosterEntry[]) => Reconciliation, run: Omit<EnrollmentRun, 'added' | 'removed' | 'total'>): Promise<Reconciliation> {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${courseId}, 47))::text`;
      const result = decide(await tx.enrollment.findMany({ where: { courseId }, select: { studentId: true, active: true } }));
      const at = new Date(run.occurredAt);
      for (const studentId of result.activate) await tx.enrollment.upsert({ where: { studentId_courseId: { studentId, courseId } },
        create: { studentId, courseId, active: true, updatedAt: at }, update: { active: true, updatedAt: at } });
      if (result.deactivate.length) await tx.enrollment.updateMany({ where: { courseId, studentId: { in: [...result.deactivate] } }, data: { active: false, updatedAt: at } });
      await tx.enrollmentRun.create({ data: { ...run, occurredAt: at, added: result.activate.length, removed: result.deactivate.length, total: result.total } });
      return result;
    }, { timeout: 20000 });
  }
  async runs(courseId: string, limit: number): Promise<EnrollmentRun[]> {
    const rows = await this.db.enrollmentRun.findMany({ where: { courseId }, orderBy: { occurredAt: 'desc' }, take: limit });
    return rows.map(row => ({ ...row, occurredAt: row.occurredAt.toISOString() }));
  }
  async linkSection(section: LinkedSection, at: string): Promise<void> {
    const data = { code: section.code, period: section.period, updatedAt: new Date(at) };
    await this.db.registrySection.upsert({ where: { courseId: section.courseId }, create: { courseId: section.courseId, ...data }, update: data });
  }
  async sections(): Promise<LinkedSection[]> {
    return this.db.registrySection.findMany({ orderBy: [{ period: 'asc' }, { code: 'asc' }], select: { courseId: true, code: true, period: true } });
  }
  async claimRun(run: Pick<SyncRun, 'id' | 'trigger' | 'slot' | 'actorId' | 'startedAt'>, staleBefore: string): Promise<boolean> {
    return this.db.$transaction(async tx => {
      // Serializes claims across replicas; the unique slot also guards the nightly run at the constraint level.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('enrollments.registry_sync', 0))::text`;
      const stale = new Date(staleBefore);
      await tx.registrySyncRun.updateMany({ where: { status: 'RUNNING', startedAt: { lt: stale } }, data: { status: 'FAILED', error: 'ABANDONED', finishedAt: new Date() } });
      if (await tx.registrySyncRun.count({ where: { status: 'RUNNING' } })) return false;
      if (run.slot && await tx.registrySyncRun.count({ where: { slot: run.slot } })) return false;
      await tx.registrySyncRun.create({ data: { ...run, status: 'RUNNING', startedAt: new Date(run.startedAt) } });
      return true;
    });
  }
  async finishRun(id: string, outcome: SyncTotals & { status: 'SUCCEEDED' | 'FAILED'; error: string | null; finishedAt: string }): Promise<SyncRun> {
    return this.toRun(await this.db.registrySyncRun.update({ where: { id }, data: { ...outcome, finishedAt: new Date(outcome.finishedAt) } }));
  }
  async syncRuns(limit: number): Promise<SyncRun[]> {
    return (await this.db.registrySyncRun.findMany({ orderBy: { startedAt: 'desc' }, take: limit })).map(row => this.toRun(row));
  }
  private toRun(row: { trigger: string; status: string; startedAt: Date; finishedAt: Date | null } & Omit<SyncRun, 'trigger' | 'status' | 'startedAt' | 'finishedAt'>): SyncRun {
    return { ...row, trigger: row.trigger as SyncRun['trigger'], status: row.status as SyncRun['status'], startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null };
  }
  async onModuleDestroy() { await this.db.$disconnect(); }
}
