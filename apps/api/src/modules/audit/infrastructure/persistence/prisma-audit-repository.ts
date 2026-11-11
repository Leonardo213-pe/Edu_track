import { PrismaPg } from '@prisma/adapter-pg';
import { capPool } from '../../../../platform/persistence/pool-size';
import { PrismaClient } from './generated/client';
import type { AuditEntry, ChainStatus } from '../../domain/audit';
import type { AuditFilter, AuditRepository } from '../../application/ports';

/** Read-only adapter: entries are written exclusively by the audit.append_entry database function. */
export class PrismaAuditRepository implements AuditRepository {
  private readonly db: PrismaClient;
  constructor(url: string) { this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: capPool(3), connectionTimeoutMillis: 5000 }) }); }
  async list(filter: AuditFilter, limit: number, offset: number): Promise<AuditEntry[]> {
    const rows = await this.db.auditEntry.findMany({ where: { ...(filter.entity ? { entity: filter.entity } : {}), ...(filter.entityId ? { entityId: filter.entityId } : {}) },
      orderBy: { id: 'desc' }, take: limit, skip: offset });
    return rows.map(row => ({ ...row, id: row.id.toString(), occurredAt: row.occurredAt.toISOString(),
      before: row.before as Record<string, unknown> | null, after: row.after as Record<string, unknown> | null }));
  }
  async verify(): Promise<ChainStatus> {
    const [row] = await this.db.$queryRaw<{ checked: bigint; first_invalid: bigint | null }[]>`SELECT checked, first_invalid FROM audit.verify_chain()`;
    return { checked: Number(row?.checked ?? 0), valid: row?.first_invalid == null, firstInvalidId: row?.first_invalid == null ? null : row.first_invalid.toString() };
  }
  async head(): Promise<{ id: string; hash: string } | null> {
    const row = await this.db.auditEntry.findFirst({ orderBy: { id: 'desc' }, select: { id: true, hash: true } });
    return row ? { id: row.id.toString(), hash: row.hash } : null;
  }
  async hashesOf(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db.auditEntry.findMany({ where: { id: { in: ids.map(id => BigInt(id)) } }, select: { id: true, hash: true } });
    return new Map(rows.map(row => [row.id.toString(), row.hash]));
  }
  async onModuleDestroy() { await this.db.$disconnect(); }
}
