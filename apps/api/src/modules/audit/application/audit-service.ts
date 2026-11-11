import { AuditError, auditPage, changedFields } from '../domain/audit';
import type { AuditDirectory, AuditFilter, AuditRepository } from './ports';

/** CU-14: the administrator consults grade and published-exam changes and verifies the hash chain. */
export class AuditService {
  constructor(private readonly repo: AuditRepository, private readonly directory: AuditDirectory) {}
  private async administrator(actorId: string): Promise<void> {
    if (await this.directory.role(actorId) !== 'ADMIN') throw new AuditError('FORBIDDEN');
  }
  async entries(actorId: string, filter: AuditFilter, limit = 50, offset = 0) {
    await this.administrator(actorId); auditPage(limit, offset);
    if (filter.entity && !['GRADE', 'ASSESSMENT'].includes(filter.entity)) throw new AuditError('INVALID_INPUT');
    const entries = await this.repo.list(filter, limit, offset);
    const names = await this.directory.names([...new Set(entries.map(entry => entry.actorId))]);
    return entries.map(entry => ({ ...entry, actorName: names.get(entry.actorId) ?? entry.actorId, changes: changedFields(entry.before, entry.after) }));
  }
  async verify(actorId: string) { await this.administrator(actorId); return this.repo.verify(); }
}
