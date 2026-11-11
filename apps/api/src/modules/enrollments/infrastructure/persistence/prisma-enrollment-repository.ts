import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';
import type { Reconciliation, RosterEntry } from '../../domain/enrollment';
import type { EnrollmentRepository, EnrollmentRun } from '../../application/ports';

export class PrismaEnrollmentRepository implements EnrollmentRepository {
  private readonly db: PrismaClient;
  constructor(url: string) { this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 5, connectionTimeoutMillis: 5000 }) }); }

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
  async onModuleDestroy() { await this.db.$disconnect(); }
}
