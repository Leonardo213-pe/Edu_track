import { PrismaPg } from '@prisma/adapter-pg';
import { capPool } from '../../../../platform/persistence/pool-size';
import { PrismaClient, Prisma } from './generated/client';
import { AUDIT_ACTOR_SETTING } from '../../../audit/public';
import { Grade, GradingError, type GradeOrigin } from '../../domain/grading';
import type { GradeRepository } from '../../application/ports';

type Row = Prisma.GradeGetPayload<object>;
export class PrismaGradeRepository implements GradeRepository {
  private readonly db: PrismaClient;
  constructor(url: string) { this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: capPool(5), connectionTimeoutMillis: 5000 }) }); }
  private map(row: Row): Grade {
    return Grade.restore({ ...row, origin: row.origin as GradeOrigin, detail: row.detail as Record<string, unknown>, gradedAt: row.gradedAt.toISOString() });
  }
  async forCourse(courseId: string) { return (await this.db.grade.findMany({ where: { courseId } })).map(row => this.map(row)); }
  async forStudent(courseId: string, studentId: string) { return (await this.db.grade.findMany({ where: { courseId, studentId } })).map(row => this.map(row)); }
  async find(assessmentId: string, studentId: string) {
    const row = await this.db.grade.findUnique({ where: { assessmentId_studentId: { assessmentId, studentId } } }); return row ? this.map(row) : null;
  }
  async save(grade: Grade, expectedVersion: number | null, actorId: string): Promise<void> {
    const { id, assessmentId, courseId, studentId, detail, gradedAt, ...rest } = grade.data;
    const data = { ...rest, detail: detail as Prisma.InputJsonValue, gradedAt: new Date(gradedAt) };
    try {
      await this.db.$transaction(async tx => {
        // The grades table trigger appends the audit entry (actor, before/after, hash chain) in this same transaction.
        await tx.$queryRaw`SELECT set_config(${AUDIT_ACTOR_SETTING}, ${actorId}, true)`;
        if (expectedVersion === null) { await tx.grade.create({ data: { ...data, id, assessmentId, courseId, studentId } }); return; }
        const result = await tx.grade.updateMany({ where: { assessmentId, studentId, version: expectedVersion }, data });
        if (result.count !== 1) throw new GradingError('CONFLICT');
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new GradingError('CONFLICT');
      throw error;
    }
  }
  async onModuleDestroy() { await this.db.$disconnect(); }
}
