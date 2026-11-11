import { beforeEach, describe, expect, it } from 'vitest';
import { MonitoringService } from './monitoring-service';
import { breaches, bucketIndex, DEFAULT_THRESHOLDS, MetricsAccumulator, quantile, summarize, type MetricRow } from '../domain/metrics';

let stored: (MetricRow & { instance: string })[], beats: Map<string, { startedAt: string; lastSeenAt: string }>, now: string, failAdd: boolean, pruned: string[];
let exams: { activeAttempts: number; outbox: { pending: number; failing: number; oldestPendingSeconds: number | null } };
let service: MonitoringService;
beforeEach(() => {
  stored = []; beats = new Map(); now = '2026-11-20T10:00:30.000Z'; failAdd = false; pruned = [];
  exams = { activeAttempts: 7, outbox: { pending: 0, failing: 0, oldestPendingSeconds: null } };
  // Explicit doubles of the metrics store and of the exams/submissions/audit/enrollments contracts.
  service = new MonitoringService({
    add: async (instance, rows) => { if (failAdd) throw new Error('db down'); stored.push(...rows.map(row => ({ ...row, instance }))); },
    since: async from => stored.filter(row => row.minute >= from),
    heartbeat: async (instance, startedAt) => { beats.set(instance, { startedAt, lastSeenAt: now }); },
    instances: async () => [...beats.entries()].map(([id, value]) => ({ id, ...value })),
    prune: async before => { pruned.push(before); },
  }, { exams: async () => exams, submissions: async () => ({ pending: 2, failing: 1, oldestPendingSeconds: 300 }), lastAnchor: async () => ({ entryId: '9', anchoredAt: '2026-11-20T09:59:30.000Z' }) },
  { recentRuns: async () => [{ id: 'r', status: 'FAILED', trigger: 'SCHEDULED', startedAt: '2026-11-20T07:00:00.000Z', error: 'REGISTRY_UNAVAILABLE: HTTP_503', retries: 3 }] },
  { role: async id => id === 'admin' ? 'ADMIN' : 'TEACHER' }, { now: () => now }, 'api-1', DEFAULT_THRESHOLDS);
});

describe('latency histogram', () => {
  it('places samples in fixed buckets and reads conservative quantiles', () => {
    expect([0, 5, 6, 1000, 1001, 99999].map(bucketIndex)).toEqual([0, 0, 1, 9, 10, 14]);
    const buckets = new Array(15).fill(0); buckets[2] = 90; buckets[9] = 10;
    expect(quantile(buckets, 0.5)).toBe(25); expect(quantile(buckets, 0.95)).toBe(1000);
    expect(quantile(new Array(15).fill(0), 0.5)).toBeNull();
    const tail = new Array(15).fill(0); tail[14] = 1; expect(quantile(tail, 0.95)).toBe(Infinity);
  });
  it('accumulates per minute and route, restores failed flushes and merges replicas', () => {
    const acc = new MetricsAccumulator();
    acc.record({ method: 'GET', route: '/api/x', status: 200, durationMs: 20, at: '2026-11-20T10:00:01.000Z' });
    acc.record({ method: 'GET', route: '/api/x', status: 503, durationMs: 2000, at: '2026-11-20T10:00:59.000Z' });
    const rows = acc.drain(); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ minute: '2026-11-20T10:00:00.000Z', count: 2, errors: 1, totalMs: 2020 });
    expect(acc.drain()).toEqual([]);
    acc.record({ method: 'GET', route: '/api/x', status: 200, durationMs: 20, at: '2026-11-20T10:00:10.000Z' }); acc.restore(rows); acc.restore([{ ...rows[0]!, route: '/api/y' }]);
    const merged = summarize(acc.drain());
    expect(merged.total).toMatchObject({ count: 5, errors: 2, errorRatePct: 40 });
    expect(merged.routes.map(route => route.route)).toEqual(['/api/x', '/api/y']);
  });
  it('raises alerts only above thresholds with enough traffic', () => {
    const slow = { method: 'PUT', route: '/api/exams/:id', count: 30, errors: 0, errorRatePct: 0, p50Ms: 300, p95Ms: 1500, avgMs: 400 };
    const keys = breaches({ routes: [slow, { ...slow, route: '/api/few', count: 2 }], total: { ...slow, errors: 3, errorRatePct: 10 } },
      { exams: { pending: 1, failing: 0, oldestPendingSeconds: 500 }, ok: { pending: 0, failing: 0, oldestPendingSeconds: null } }, DEFAULT_THRESHOLDS, 'W').map(alert => alert.key);
    expect(keys).toEqual(['P95:PUT:/api/exams/:id:W', 'ERRORS:W', 'OUTBOX:exams:W']);
    expect(breaches({ routes: [{ ...slow, p95Ms: Infinity }], total: { ...slow, errorRatePct: 0 } }, {}, DEFAULT_THRESHOLDS, 'W')[0]!.body).toContain('> 10 s');
  });
});
describe('monitoring panel', () => {
  it('flushes this replica, keeps samples when the store fails and builds the ADMIN dashboard', async () => {
    for (let i = 0; i < 25; i++) service.record({ method: 'GET', route: '/api/courses', status: i < 5 ? 500 : 200, durationMs: i < 23 ? 40 : 1800 });
    failAdd = true; await expect(service.flush()).rejects.toThrow('db down');
    failAdd = false; expect(await service.flush()).toBe(1); expect(pruned).toHaveLength(1);
    const panel = await service.dashboard('admin', 15);
    expect(panel.total).toMatchObject({ count: 25, errors: 5, errorRatePct: 20, p50Ms: 50, p95Ms: 2500 });
    expect(panel.activeAttempts).toBe(7);
    expect(panel.replicas).toEqual([{ id: 'api-1', startedAt: now, lastSeenAt: now, alive: true }]);
    expect(panel.jobs.map(job => job.state)).toEqual(['OK', 'ATRASADO', 'FALLIDA', 'OK']);
    expect(panel.alerts.map(alert => alert.title)).toEqual(['Latencia alta: GET /api/courses', 'Tasa de errores alta', 'Cola atrasada: Control de plagio (submissions)']);
    exams.outbox = { pending: 3, failing: 2, oldestPendingSeconds: 10 };
    expect((await service.dashboard('admin')).jobs[0]!.state).toBe('REINTENTANDO');
    expect((await service.alerts()).length).toBe(3);
  });
  it('is only for administrators and validates the window', async () => {
    await expect(service.dashboard('teacher')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.dashboard('admin', 0)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
