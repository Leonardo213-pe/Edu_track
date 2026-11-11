import { describe, expect, it } from 'vitest';
import { AlertService } from './alert-service';
import { registryAlerts, type SyncRunFact } from '../domain/alerts';

const now = '2026-11-12T12:00:00.000Z';
const run = (id: string, status: SyncRunFact['status'], startedAt: string, trigger: SyncRunFact['trigger'] = 'SCHEDULED'): SyncRunFact =>
  ({ id, status, trigger, startedAt, error: status === 'FAILED' ? 'REGISTRY_UNAVAILABLE: HTTP_503' : null, retries: 3 });

describe('operational alerts', () => {
  it('alerts recent failed registry runs only, with a stable key', () => {
    const alerts = registryAlerts([run('a', 'FAILED', '2026-11-12T07:00:00.000Z'), run('b', 'SUCCEEDED', '2026-11-12T07:00:00.000Z'),
      run('c', 'FAILED', '2026-11-10T07:00:00.000Z'), run('d', 'FAILED', '2026-11-12T08:00:00.000Z', 'MANUAL')], now);
    expect(alerts.map(alert => alert.key)).toEqual(['REGISTRY_SYNC_FAILED:a', 'REGISTRY_SYNC_FAILED:d']);
    expect(alerts[0]!.body).toContain('Ejecución nocturna');
    expect(alerts[1]!.body).toContain('Ejecución manual');
    expect(alerts[0]!.body).toContain('3 reintento(s)');
  });
  it('sends every alert to every administrator and skips work when nothing failed', async () => {
    const sent: { userId: string; key: string }[] = [];
    // Explicit doubles of the identity, notification and enrollments contracts.
    const service = new AlertService({ administrators: async () => [{ id: 'admin-1' }, { id: 'admin-2' }] },
      { send: async deliveries => { sent.push(...deliveries.map(item => ({ userId: item.userId, key: item.alert.key }))); } },
      { recentRuns: async () => [run('a', 'FAILED', '2026-11-12T07:00:00.000Z')] }, { now: () => now });
    service.addSource(async () => [{ key: 'P95:x', title: 't', body: 'b' }]);
    expect(await service.check()).toBe(4);
    expect(sent).toContainEqual({ userId: 'admin-2', key: 'REGISTRY_SYNC_FAILED:a' });
    const empty = new AlertService({ administrators: async () => { throw new Error('not called'); } }, { send: async () => undefined },
      { recentRuns: async () => [] }, { now: () => now });
    expect(await empty.check()).toBe(0);
    const nobody = new AlertService({ administrators: async () => [] }, { send: async () => { throw new Error('not called'); } },
      { recentRuns: async () => [run('a', 'FAILED', '2026-11-12T07:00:00.000Z')] }, { now: () => now });
    expect(await nobody.check()).toBe(0);
  });
});
