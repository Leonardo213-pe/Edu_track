export class AuditError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'INVALID_INPUT') { super(code); }
}
export interface AuditEntry {
  id: string; entity: string; entityId: string; action: string; actorId: string; occurredAt: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null; prevHash: string; hash: string;
}
export interface ChainStatus { checked: number; valid: boolean; firstInvalidId: string | null }
const ignored = new Set(['version', 'revision']);
/** Field-level difference of an audited row, used to present "valor anterior → valor nuevo" (EAC-04). */
export function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown> | null): { field: string; before: unknown; after: unknown }[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys].filter(key => !ignored.has(key) && JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]))
    .sort().map(field => ({ field, before: before?.[field] ?? null, after: after?.[field] ?? null }));
}
export function auditPage(limit: number, offset: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw new AuditError('INVALID_INPUT');
}
