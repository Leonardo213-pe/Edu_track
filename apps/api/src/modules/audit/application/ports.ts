import type { AuditEntry, ChainStatus } from '../domain/audit';
export interface AuditFilter { entity?: string; entityId?: string }
export interface AuditRepository {
  list(filter: AuditFilter, limit: number, offset: number): Promise<AuditEntry[]>;
  verify(): Promise<ChainStatus>;
}
export interface AuditDirectory {
  role(id: string): Promise<string | null>;
  names(ids: string[]): Promise<Map<string, string>>;
}
