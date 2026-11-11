import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';
import type { RiskRules } from '../../domain/risk';
import type { ActivitySummary, AnalyticsRepository } from '../../application/ports';

export class PrismaAnalyticsRepository implements AnalyticsRepository {
  private readonly db: PrismaClient;
  constructor(url: string) { this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 3, connectionTimeoutMillis: 5000 }) }); }
  async heartbeat(userId: string, courseId: string): Promise<number | null> {
    // Days follow the institution's time zone; repeated beats within 50 s do not inflate the connected minutes.
    const [row] = await this.db.$queryRaw<{ minutes: number }[]>`
      INSERT INTO analytics.activity ("userId", "courseId", day, minutes, "lastSeenAt")
      VALUES (${userId}::uuid, ${courseId}::uuid, (clock_timestamp() AT TIME ZONE 'America/Lima')::date, 1, clock_timestamp())
      ON CONFLICT ("userId", "courseId", day) DO UPDATE SET minutes = LEAST(1440, analytics.activity.minutes + 1), "lastSeenAt" = clock_timestamp()
      WHERE analytics.activity."lastSeenAt" <= clock_timestamp() - interval '50 seconds'
      RETURNING minutes`;
    return row?.minutes ?? null;
  }
  async activity(courseId: string): Promise<ActivitySummary[]> {
    return (await this.db.$queryRaw<{ userId: string; totalMinutes: bigint; lastWeekMinutes: bigint; lastSeenAt: Date }[]>`
      SELECT "userId", sum(minutes) AS "totalMinutes",
        sum(minutes) FILTER (WHERE day > (clock_timestamp() AT TIME ZONE 'America/Lima')::date - 7) AS "lastWeekMinutes", max("lastSeenAt") AS "lastSeenAt"
      FROM analytics.activity WHERE "courseId" = ${courseId}::uuid GROUP BY "userId"`)
      .map(row => ({ userId: row.userId, totalMinutes: Number(row.totalMinutes), lastWeekMinutes: Number(row.lastWeekMinutes ?? 0), lastSeenAt: row.lastSeenAt }));
  }
  async rules(courseId: string) {
    const row = await this.db.riskRule.findUnique({ where: { courseId } });
    return row ? { minProgress: row.minProgress, minAverageCents: row.minAverageCents, maxInactiveDays: row.maxInactiveDays, maxMissed: row.maxMissed,
      updatedBy: row.updatedBy, updatedAt: row.updatedAt.toISOString() } : null;
  }
  async saveRules(courseId: string, rules: RiskRules, actorId: string) {
    const data = { ...rules, updatedBy: actorId, updatedAt: new Date() };
    await this.db.riskRule.upsert({ where: { courseId }, create: { courseId, ...data }, update: data });
  }
  async onModuleDestroy() { await this.db.$disconnect(); }
}
