import type { AuditEntry, ChainStatus } from '../domain/audit';
export interface AuditFilter { entity?: string; entityId?: string }
export interface AuditRepository {
  list(filter: AuditFilter, limit: number, offset: number): Promise<AuditEntry[]>;
  verify(): Promise<ChainStatus>;
  /** Last entry of the chain (ID and hash), or null if empty. */
  head(): Promise<{ id: string; hash: string } | null>;
  hashesOf(ids: string[]): Promise<Map<string, string>>;
}
/** An anchor: the chain head copied OUTSIDE the database (separate volume) so a full rewrite of the chain is detectable. */
export interface AuditAnchor { entryId: string; hash: string; anchoredAt: string }
export interface AnchorStore {
  last(): Promise<AuditAnchor | null>;
  append(anchor: AuditAnchor): Promise<void>;
  all(limit: number): Promise<AuditAnchor[]>;
}
export interface AuditClock { now(): string }
export interface AuditDirectory {
  role(id: string): Promise<string | null>;
  names(ids: string[]): Promise<Map<string, string>>;
}
