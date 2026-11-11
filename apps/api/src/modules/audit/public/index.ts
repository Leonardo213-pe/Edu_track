/**
 * Public contract of the audit module (CAR-12). Writers never touch audit tables: they declare the actor in the
 * transaction-local setting below and their audited tables call the database function `audit.append_entry`
 * through the `audit.record_row_change(entity)` trigger, so the change and its audit entry commit atomically.
 */
export const AUDIT_ACTOR_SETTING = 'edutrack.actor';
export type AuditedEntity = 'GRADE' | 'ASSESSMENT';
