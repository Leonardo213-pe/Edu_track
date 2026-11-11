import { EnrollmentError, reconcile } from '../domain/enrollment';
import { backoffMs, MAX_RETRIES, nightlyWindow, normalizeSection, RegistryUnavailableError, STALE_RUN_MS, type RegistrySectionKey, type SyncTotals } from '../domain/registry';
import type { RegistrySections, RegistrySyncStatus, RegistrySyncSummary } from '../public';
import type { AcademicRegistry, EnrollmentDirectory, EnrollmentRepository, RegistryLookup, RegistrySyncRepository, SyncRun, SyncRuntime } from './ports';

export interface RegistrySyncPolicy { readonly retries: number; readonly baseDelayMs: number; readonly systemActorId: string }

/**
 * CU-12: consumes the official roster of every linked section from the Academic Registry and applies it to the local
 * projection with the existing idempotent reconciliation (source REGISTRY_SYNC). The LMS never creates enrollments.
 * Failures are retried with backoff (max. 3 retries), recorded as a FAILED run and surfaced as alerts by administration;
 * they never block the rest of the LMS.
 */
export class RegistrySyncService implements RegistrySections, RegistrySyncStatus {
  constructor(private readonly repo: EnrollmentRepository & RegistrySyncRepository, private readonly registry: AcademicRegistry,
    private readonly directory: EnrollmentDirectory, private readonly runtime: SyncRuntime,
    private readonly policy: RegistrySyncPolicy = { retries: MAX_RETRIES, baseDelayMs: 1000, systemActorId: '00000000-0000-4000-8000-000000000000' }) {
    if (!Number.isInteger(policy.retries) || policy.retries < 0 || policy.retries > MAX_RETRIES) throw new RangeError('retries');
  }

  async link(courseId: string, code: string, period: string): Promise<void> {
    const section = normalizeSection(code, period);
    await this.repo.linkSection({ courseId, ...section }, this.runtime.now());
  }
  async recentRuns(limit: number): Promise<RegistrySyncSummary[]> {
    return (await this.repo.syncRuns(Math.min(Math.max(limit, 1), 100))).map(({ id, trigger, status, startedAt, finishedAt, error, retries, sections }) =>
      ({ id, trigger, status, startedAt, finishedAt, error, retries, sections }));
  }

  private async administrator(actorId: string): Promise<void> {
    const [actor] = await this.directory.byIds([actorId]);
    if (!actor?.active || actor.role !== 'ADMIN') throw new EnrollmentError('FORBIDDEN');
  }
  async overview(actorId: string) {
    await this.administrator(actorId);
    const [registry, runs, sections] = await Promise.all([this.registry.health(), this.repo.syncRuns(30), this.repo.sections()]);
    return { registry, runs, sections: sections.length, schedule: { time: '02:00', timeZone: 'America/Lima' } };
  }
  /** "Sincronizar ahora" (ADMIN). Refused while another run is in progress on any replica. */
  async runNow(actorId: string): Promise<SyncRun> {
    await this.administrator(actorId);
    if (!this.registry.configured) throw new EnrollmentError('REGISTRY_NOT_CONFIGURED');
    const run = await this.execute('MANUAL', null, actorId);
    if (!run) throw new EnrollmentError('SYNC_IN_PROGRESS');
    return run;
  }
  /** Called periodically by the in-process scheduler: runs once per Lima day from 02:00 on. */
  async runScheduled(): Promise<SyncRun | null> {
    if (!this.registry.configured) return null;
    const window = nightlyWindow(this.runtime.now());
    return window.due ? this.execute('SCHEDULED', window.slot, this.policy.systemActorId) : null;
  }

  private async lookup(section: RegistrySectionKey, totals: SyncTotals): Promise<RegistryLookup> {
    for (let retry = 0; ; retry++) {
      try { return await this.registry.studentsOf(section); } catch (error) {
        if (!(error instanceof RegistryUnavailableError) || retry >= this.policy.retries) throw error;
        totals.retries++; await this.runtime.sleep(backoffMs(retry + 1, this.policy.baseDelayMs));
      }
    }
  }
  private async apply(courseId: string, emails: readonly string[], totals: SyncTotals): Promise<void> {
    const requested = [...new Set(emails.map(email => email.trim().toLowerCase()).filter(Boolean))];
    const students: string[] = [];
    for (let offset = 0; offset < requested.length; offset += 1000) {
      const chunk = requested.slice(offset, offset + 1000);
      const found = new Map((await this.directory.byEmails(chunk)).map(user => [user.email, user]));
      for (const email of chunk) {
        const user = found.get(email);
        // Registry students without an active LMS student account are counted, never created here (identity owns accounts).
        if (user?.active && user.role === 'STUDENT') students.push(user.id); else totals.unknown++;
      }
    }
    const result = await this.repo.reconcile(courseId, current => reconcile(current, students),
      { id: this.runtime.id(), courseId, actorId: this.policy.systemActorId, source: 'REGISTRY_SYNC', occurredAt: this.runtime.now() });
    totals.added += result.activate.length; totals.removed += result.deactivate.length;
  }
  private async execute(trigger: 'SCHEDULED' | 'MANUAL', slot: string | null, actorId: string): Promise<SyncRun | null> {
    const now = this.runtime.now(); const id = this.runtime.id();
    const staleBefore = new Date(new Date(now).getTime() - STALE_RUN_MS).toISOString();
    if (!await this.repo.claimRun({ id, trigger, slot, actorId, startedAt: now }, staleBefore)) return null;
    const totals: SyncTotals = { sections: 0, added: 0, removed: 0, unknown: 0, skipped: 0, retries: 0 };
    let error: string | null = null;
    try {
      for (const section of await this.repo.sections()) {
        const lookup = await this.lookup(section, totals);
        if (!lookup.found) { totals.skipped++; continue; }
        await this.apply(section.courseId, lookup.emails, totals); totals.sections++;
      }
    } catch (failure) {
      // Registry still unavailable after the retries: stop this run (do not hammer the legacy system) and record why.
      error = failure instanceof RegistryUnavailableError ? `REGISTRY_UNAVAILABLE: ${failure.reason}`.slice(0, 200) : 'SYNC_ERROR';
    }
    return this.repo.finishRun(id, { ...totals, status: error ? 'FAILED' : 'SUCCEEDED', error, finishedAt: this.runtime.now() });
  }
}
