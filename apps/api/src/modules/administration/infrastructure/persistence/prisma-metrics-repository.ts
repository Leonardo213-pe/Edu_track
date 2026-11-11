import { PrismaPg } from '@prisma/adapter-pg';
import { capPool } from '../../../../platform/persistence/pool-size';
import { PrismaClient } from './generated/client';
import type { MetricsRepository } from '../../application/ports';
import type { MetricRow } from '../../domain/metrics';

export class PrismaMetricsRepository implements MetricsRepository {
  private readonly db: PrismaClient;
  constructor(url: string) { this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: capPool(2), connectionTimeoutMillis: 5000 }) }); }
  async add(instance: string, rows: readonly MetricRow[]): Promise<void> {
    await this.db.$transaction(async tx => {
      for (const row of rows) await tx.$executeRaw`
        INSERT INTO administration.request_metrics AS m (minute, instance, method, route, count, errors, "totalMs", buckets)
        VALUES (${row.minute}::timestamptz, ${instance}, ${row.method}, ${row.route.slice(0, 200)}, ${row.count}, ${row.errors}, ${row.totalMs}, ${row.buckets}::int[])
        ON CONFLICT (minute, instance, method, route) DO UPDATE SET count = m.count + EXCLUDED.count, errors = m.errors + EXCLUDED.errors,
          "totalMs" = m."totalMs" + EXCLUDED."totalMs",
          buckets = ARRAY(SELECT a + b FROM unnest(m.buckets, EXCLUDED.buckets) AS t(a, b))`;
    });
  }
  async since(fromIso: string): Promise<MetricRow[]> {
    const rows = await this.db.requestMetric.findMany({ where: { minute: { gte: new Date(fromIso) } } });
    return rows.map(row => ({ minute: row.minute.toISOString(), method: row.method, route: row.route, count: row.count, errors: row.errors, totalMs: Number(row.totalMs), buckets: row.buckets }));
  }
  async heartbeat(instance: string, startedAt: string): Promise<void> {
    await this.db.apiInstance.upsert({ where: { id: instance }, create: { id: instance, startedAt: new Date(startedAt), lastSeenAt: new Date() },
      update: { startedAt: new Date(startedAt), lastSeenAt: new Date() } });
  }
  async instances() {
    const rows = await this.db.apiInstance.findMany({ where: { lastSeenAt: { gte: new Date(Date.now() - 3_600_000) } }, orderBy: { id: 'asc' } });
    return rows.map(row => ({ id: row.id, startedAt: row.startedAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString() }));
  }
  async prune(beforeIso: string): Promise<void> {
    await this.db.requestMetric.deleteMany({ where: { minute: { lt: new Date(beforeIso) } } });
    await this.db.apiInstance.deleteMany({ where: { lastSeenAt: { lt: new Date(beforeIso) } } });
  }
  async onModuleDestroy() { await this.db.$disconnect(); }
}
