import { AuditError, auditPage, changedFields } from '../domain/audit';
import { SYSTEM_ACTOR_ID } from '../public';
import type { AnchorStore, AuditAnchor, AuditClock, AuditDirectory, AuditFilter, AuditRepository } from './ports';
import type { AuditAnchorStatus } from '../public';

/** CU-14: the administrator consults grade and published-exam changes and verifies the hash chain. */
export class AuditService implements AuditAnchorStatus {
  constructor(private readonly repo: AuditRepository, private readonly directory: AuditDirectory,
    private readonly anchors?: AnchorStore, private readonly clock: AuditClock = { now: () => new Date().toISOString() }) {}
  private async administrator(actorId: string): Promise<void> {
    if (await this.directory.role(actorId) !== 'ADMIN') throw new AuditError('FORBIDDEN');
  }
  async entries(actorId: string, filter: AuditFilter, limit = 50, offset = 0) {
    await this.administrator(actorId); auditPage(limit, offset);
    if (filter.entity && !['GRADE', 'ASSESSMENT'].includes(filter.entity)) throw new AuditError('INVALID_INPUT');
    const entries = await this.repo.list(filter, limit, offset);
    const names = await this.directory.names([...new Set(entries.map(entry => entry.actorId))]);
    names.set(SYSTEM_ACTOR_ID, 'Sistema (calificación automática)');
    return entries.map(entry => ({ ...entry, actorName: names.get(entry.actorId) ?? entry.actorId, changes: changedFields(entry.before, entry.after) }));
  }
  async verify(actorId: string) { await this.administrator(actorId); return this.repo.verify(); }

  /** Periodic job: copies the current chain head to the anchor store unless it is already anchored (idempotent). */
  async anchor(): Promise<AuditAnchor | null> {
    if (!this.anchors) return null;
    const head = await this.repo.head(); if (!head) return null;
    const last = await this.anchors.last(); if (last?.entryId === head.id && last.hash === head.hash) return null;
    const anchor = { entryId: head.id, hash: head.hash, anchoredAt: this.clock.now() };
    await this.anchors.append(anchor); return anchor;
  }
  /** Compares every external anchor with the database: a rewritten chain no longer matches its anchored hashes. */
  async verifyAnchors(actorId: string) {
    await this.administrator(actorId);
    const anchors = this.anchors ? await this.anchors.all(1000) : [];
    const hashes = await this.repo.hashesOf([...new Set(anchors.map(anchor => anchor.entryId))]);
    const mismatch = anchors.find(anchor => hashes.get(anchor.entryId) !== anchor.hash) ?? null;
    return { configured: !!this.anchors, anchors: anchors.length, valid: !mismatch, firstMismatch: mismatch, lastAnchor: anchors.at(-1) ?? null };
  }
  async lastAnchor(): Promise<{ entryId: string; anchoredAt: string } | null> {
    const last = this.anchors ? await this.anchors.last() : null; return last ? { entryId: last.entryId, anchoredAt: last.anchoredAt } : null;
  }
}
