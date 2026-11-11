import type { Reconciliation, RosterEntry } from '../domain/enrollment';
export interface EnrollmentRun { id: string; courseId: string; actorId: string; source: string; added: number; removed: number; total: number; occurredAt: string }
export interface EnrollmentRepository {
  isEnrolled(studentId: string, courseId: string): Promise<boolean>;
  activeCourses(studentId: string): Promise<string[]>;
  roster(courseId: string): Promise<RosterEntry[]>;
  /** Locks the course roster, computes the reconciliation on the current rows, applies it and appends the run atomically. */
  reconcile(courseId: string, decide: (current: RosterEntry[]) => Reconciliation, run: Omit<EnrollmentRun, 'added' | 'removed' | 'total'>): Promise<Reconciliation>;
  runs(courseId: string, limit: number): Promise<EnrollmentRun[]>;
}
export interface DirectoryUser { id: string; email: string; displayName: string; role: string; active: boolean }
export interface EnrollmentDirectory {
  byIds(ids: string[]): Promise<DirectoryUser[]>;
  byEmails(emails: string[]): Promise<DirectoryUser[]>;
}
export interface EnrollmentRuntime { id(): string; now(): string }

// Academic Registry synchronization (CAR-09). The registry is external; in local Compose it is SIMULATED.
export type { RegistrySectionKey } from '../domain/registry';
import type { RegistrySectionKey, SyncStatus, SyncTotals } from '../domain/registry';
export type RegistryLookup = { readonly found: false } | { readonly found: true; readonly emails: readonly string[] };
export interface RegistryHealth { readonly configured: boolean; readonly reachable: boolean; readonly simulated: boolean; readonly mode: string; readonly latencyMs: number | null; readonly checkedAt: string }
/** Outbound port to the institutional Academic Registry. Throws RegistryUnavailableError on timeouts, 5xx or network errors. */
export interface AcademicRegistry {
  readonly configured: boolean;
  studentsOf(section: RegistrySectionKey): Promise<RegistryLookup>;
  health(): Promise<RegistryHealth>;
}
export interface LinkedSection extends RegistrySectionKey { readonly courseId: string }
export interface SyncRun extends SyncTotals {
  id: string; trigger: 'SCHEDULED' | 'MANUAL'; slot: string | null; actorId: string; status: SyncStatus;
  startedAt: string; finishedAt: string | null; error: string | null;
}
export interface RegistrySyncRepository {
  linkSection(section: LinkedSection, at: string): Promise<void>;
  sections(): Promise<LinkedSection[]>;
  /**
   * Starts a run unless another fresh run is RUNNING or the slot was already used (nightly run of the day), atomically
   * and safely across replicas. Stale RUNNING rows are closed as FAILED (ABANDONED) first.
   */
  claimRun(run: Pick<SyncRun, 'id' | 'trigger' | 'slot' | 'actorId' | 'startedAt'>, staleBefore: string): Promise<boolean>;
  finishRun(id: string, outcome: SyncTotals & { status: 'SUCCEEDED' | 'FAILED'; error: string | null; finishedAt: string }): Promise<SyncRun>;
  syncRuns(limit: number): Promise<SyncRun[]>;
}
export interface SyncRuntime { id(): string; now(): string; sleep(ms: number): Promise<void> }
