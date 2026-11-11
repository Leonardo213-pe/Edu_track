import { PrismaPg } from '@prisma/adapter-pg';
import { capPool } from '../../../../platform/persistence/pool-size';
import { PrismaClient, type Prisma } from './generated/client';
import type { ReportRecord, ReportRepository } from '../../application/ports';

export class PrismaReportRepository implements ReportRepository {
  private readonly db: PrismaClient;
  constructor(url: string) { this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: capPool(3), connectionTimeoutMillis: 5000 }) }); }
  async exists(fileId: string): Promise<boolean> { return !!(await this.db.plagiarismReport.findUnique({ where: { fileId }, select: { id: true } })); }
  async save(report: ReportRecord): Promise<void> {
    await this.db.plagiarismReport.createMany({ skipDuplicates: true, data: [{ ...report, matches: report.matches as unknown as Prisma.InputJsonValue, createdAt: new Date(report.createdAt) }] });
  }
  async forAssessment(assessmentId: string): Promise<ReportRecord[]> {
    const rows = await this.db.plagiarismReport.findMany({ where: { assessmentId }, orderBy: { createdAt: 'desc' } });
    return rows.map(row => ({ ...row, status: row.status as ReportRecord['status'], matches: row.matches as unknown as ReportRecord['matches'], createdAt: row.createdAt.toISOString() }));
  }
  async onModuleDestroy() { await this.db.$disconnect(); }
}
