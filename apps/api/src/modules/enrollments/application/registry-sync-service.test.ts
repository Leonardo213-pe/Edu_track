import { beforeEach, describe, expect, it } from 'vitest';
import { RegistrySyncService } from './registry-sync-service';
import { backoffMs, nightlyWindow, normalizeSection, RegistryUnavailableError } from '../domain/registry';
import type { Reconciliation, RosterEntry } from '../domain/enrollment';
import type { AcademicRegistry, DirectoryUser, EnrollmentRepository, EnrollmentRun, LinkedSection, RegistryLookup, RegistrySyncRepository, SyncRun } from './ports';

const people: DirectoryUser[] = [
  { id: 'admin', email: 'admin@example.test', displayName: 'Admin', role: 'ADMIN', active: true },
  { id: 'ana', email: 'ana@example.test', displayName: 'Ana', role: 'STUDENT', active: true },
  { id: 'beto', email: 'beto@example.test', displayName: 'Beto', role: 'STUDENT', active: true },
  { id: 'old', email: 'old@example.test', displayName: 'Old', role: 'STUDENT', active: false },
  { id: 'teacher', email: 'doc@example.test', displayName: 'Docente', role: 'TEACHER', active: true },
];
const SYSTEM = '00000000-0000-4000-8000-000000000000';
let rows: Map<string, RosterEntry & { courseId: string }>, runs: EnrollmentRun[], syncRuns: SyncRun[], sections: LinkedSection[];
let registryData: Map<string, string[]>, failures: number, directoryFails = false, sleeps: number[], now: string, configured: boolean, calls: number;
let service: RegistrySyncService;

beforeEach(() => {
  rows = new Map(); runs = []; syncRuns = []; sections = []; registryData = new Map(); failures = 0; directoryFails = false; sleeps = []; calls = 0;
  now = '2026-11-12T07:30:00.000Z'; configured = true; // 02:30 in Lima
  // Explicit in-memory doubles of the persistence and registry ports; PostgreSQL and the SIMULATED registry run in integration.
  const repo: EnrollmentRepository & RegistrySyncRepository = {
    isEnrolled: async () => false, activeCourses: async () => [],
    roster: async courseId => [...rows.values()].filter(row => row.courseId === courseId),
    reconcile: async (courseId, decide, run) => {
      const result: Reconciliation = decide([...rows.values()].filter(row => row.courseId === courseId));
      for (const studentId of result.activate) rows.set(`${studentId}:${courseId}`, { studentId, courseId, active: true });
      for (const studentId of result.deactivate) rows.set(`${studentId}:${courseId}`, { studentId, courseId, active: false });
      runs.unshift({ ...run, added: result.activate.length, removed: result.deactivate.length, total: result.total }); return result;
    },
    runs: async () => runs,
    linkSection: async section => { sections = [...sections.filter(item => item.courseId !== section.courseId), section]; },
    sections: async () => sections,
    claimRun: async (run, staleBefore) => {
      for (const stale of syncRuns.filter(item => item.status === 'RUNNING' && item.startedAt < staleBefore)) Object.assign(stale, { status: 'FAILED', error: 'ABANDONED' });
      if (syncRuns.some(item => item.status === 'RUNNING') || (run.slot && syncRuns.some(item => item.slot === run.slot))) return false;
      syncRuns.unshift({ ...run, status: 'RUNNING', finishedAt: null, error: null, sections: 0, added: 0, removed: 0, unknown: 0, skipped: 0, retries: 0 }); return true;
    },
    finishRun: async (id, outcome) => { const run = syncRuns.find(item => item.id === id)!; Object.assign(run, outcome); return { ...run }; },
    syncRuns: async limit => syncRuns.slice(0, limit),
  };
  const registry: AcademicRegistry = {
    get configured() { return configured; },
    studentsOf: async ({ code, period }): Promise<RegistryLookup> => {
      calls++;
      if (failures > 0) { failures--; throw new RegistryUnavailableError('HTTP_503'); }
      const emails = registryData.get(`${code}/${period}`); return emails ? { found: true, emails } : { found: false };
    },
    health: async () => ({ configured, reachable: true, simulated: true, mode: 'up', latencyMs: 3, checkedAt: now }),
  };
  let id = 0;
  service = new RegistrySyncService(repo, registry, {
    byIds: async ids => people.filter(person => ids.includes(person.id)),
    byEmails: async emails => { if (directoryFails) throw new Error('directory down'); return people.filter(person => emails.includes(person.email)); },
  }, { id: () => `id-${++id}`, now: () => now, sleep: async ms => { sleeps.push(ms); } }, { retries: 3, baseDelayMs: 100, systemActorId: SYSTEM });
});

describe('nightly window and retry rules', () => {
  it('is due from 02:00 in Lima with one slot per local day', () => {
    expect(nightlyWindow('2026-11-12T06:59:00.000Z')).toEqual({ slot: 'NIGHTLY:2026-11-12', due: false });
    expect(nightlyWindow('2026-11-12T07:00:00.000Z')).toEqual({ slot: 'NIGHTLY:2026-11-12', due: true });
    // 23:30 Lima still belongs to the previous local day, even though it is already the 13th in UTC.
    expect(nightlyWindow('2026-11-13T04:30:00.000Z')).toEqual({ slot: 'NIGHTLY:2026-11-12', due: true });
  });
  it('backs off exponentially and validates sections', () => {
    expect([1, 2, 3].map(retry => backoffMs(retry, 1000))).toEqual([1000, 2000, 4000]);
    expect(() => backoffMs(0, 1000)).toThrow(RangeError);
    expect(normalizeSection(' is-101 ', '2026-ii')).toEqual({ code: 'IS-101', period: '2026-II' });
    expect(() => normalizeSection('', '2026-II')).toThrow(RangeError);
  });
  it('rejects more than three retries', () => {
    expect(() => new RegistrySyncService({} as never, {} as never, {} as never, {} as never, { retries: 4, baseDelayMs: 1, systemActorId: SYSTEM })).toThrow(RangeError);
  });
});

describe('registry synchronization', () => {
  beforeEach(async () => {
    await service.link('course-1', 'is-101', '2026-ii');
    await service.link('course-2', 'IS-999', '2026-II');
    registryData.set('IS-101/2026-II', ['ANA@example.test', 'beto@example.test', 'ghost@example.test', 'old@example.test', 'doc@example.test']);
  });
  it('applies altas and bajas with source REGISTRY_SYNC as the system actor, skipping unknown sections', async () => {
    rows.set('old:course-1', { studentId: 'old', courseId: 'course-1', active: true });
    const run = (await service.runNow('admin'));
    expect(run).toMatchObject({ trigger: 'MANUAL', status: 'SUCCEEDED', sections: 1, skipped: 1, added: 2, removed: 1, unknown: 3, retries: 0, error: null });
    expect(runs[0]).toMatchObject({ courseId: 'course-1', source: 'REGISTRY_SYNC', actorId: SYSTEM, added: 2, removed: 1 });
    expect([...rows.values()].filter(row => row.active).map(row => row.studentId).sort()).toEqual(['ana', 'beto']);
  });
  it('is idempotent: a second run changes nothing', async () => {
    await service.runNow('admin');
    expect(await service.runNow('admin')).toMatchObject({ status: 'SUCCEEDED', added: 0, removed: 0 });
  });
  it('retries up to three times with backoff and then succeeds', async () => {
    failures = 2;
    expect(await service.runNow('admin')).toMatchObject({ status: 'SUCCEEDED', retries: 2, added: 2 });
    expect(sleeps).toEqual([100, 200]);
  });
  it('records a FAILED run after three retries without touching the projection', async () => {
    failures = 99;
    expect(await service.runNow('admin')).toMatchObject({ status: 'FAILED', retries: 3, error: 'REGISTRY_UNAVAILABLE: HTTP_503' });
    expect(calls).toBe(4); expect(sleeps).toEqual([100, 200, 400]); expect(rows.size).toBe(0);
    expect((await service.recentRuns(5))[0]).toMatchObject({ status: 'FAILED', retries: 3 });
  });
  it('records unexpected errors as SYNC_ERROR', async () => {
    directoryFails = true;
    expect(await service.runNow('admin')).toMatchObject({ status: 'FAILED', error: 'SYNC_ERROR' });
  });
  it('runs the nightly slot once per day, only from 02:00 Lima, and never concurrently', async () => {
    now = '2026-11-12T06:00:00.000Z';
    expect(await service.runScheduled()).toBeNull();
    now = '2026-11-12T07:01:00.000Z';
    expect(await service.runScheduled()).toMatchObject({ trigger: 'SCHEDULED', slot: 'NIGHTLY:2026-11-12', actorId: SYSTEM, status: 'SUCCEEDED' });
    expect(await service.runScheduled()).toBeNull();
    syncRuns.unshift({ ...syncRuns[0]!, id: 'running', slot: null, status: 'RUNNING', startedAt: now });
    await expect(service.runNow('admin')).rejects.toMatchObject({ code: 'SYNC_IN_PROGRESS' });
    now = '2026-11-12T08:00:00.000Z'; // 59 min later the crashed run is stale and no longer blocks
    expect(await service.runNow('admin')).toMatchObject({ status: 'SUCCEEDED' });
    expect(syncRuns.find(run => run.id === 'running')).toMatchObject({ status: 'FAILED', error: 'ABANDONED' });
  });
  it('only lets an active ADMIN run or inspect it, and needs a configured registry', async () => {
    await expect(service.runNow('teacher')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.overview('ana')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.overview('admin')).toMatchObject({ sections: 2, registry: { simulated: true }, schedule: { time: '02:00', timeZone: 'America/Lima' } });
    configured = false;
    await expect(service.runNow('admin')).rejects.toMatchObject({ code: 'REGISTRY_NOT_CONFIGURED' });
    expect(await service.runScheduled()).toBeNull();
  });
});
