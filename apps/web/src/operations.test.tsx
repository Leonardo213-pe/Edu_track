import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { RegistryView, type RegistryOverview, type RegistryRun } from './RegistryView';
import { MonitoringView, type MonitoringPanel } from './MonitoringView';

// fetch is an explicit test double: permissions and the SIMULATED registry are verified by API integration tests.
afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const failedRun: RegistryRun = { id: 'r1', trigger: 'SCHEDULED', status: 'FAILED', startedAt: '2026-11-12T07:00:00.000Z', finishedAt: '2026-11-12T07:00:08.000Z',
  sections: 0, added: 0, removed: 0, unknown: 0, skipped: 0, retries: 3, error: 'REGISTRY_UNAVAILABLE: HTTP_503' };
const overview: RegistryOverview = { registry: { configured: true, reachable: true, simulated: true, mode: 'up', latencyMs: 4, checkedAt: '' },
  runs: [failedRun], sections: 2, schedule: { time: '02:00', timeZone: 'America/Lima' } };

test('administrator sees the SIMULATED registry, the run history and synchronizes on demand', async () => {
  const ok: RegistryRun = { ...failedRun, id: 'r2', trigger: 'MANUAL', status: 'SUCCEEDED', sections: 2, added: 3, removed: 1, unknown: 1, retries: 0, error: null };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => json(init?.method === 'POST' ? ok : overview));
  vi.stubGlobal('fetch', fetcher);
  render(<RegistryView token="jwt" failed={vi.fn()} />);
  expect(await screen.findByText('SIMULADO')).not.toBeNull();
  expect(screen.getByText('Disponible (4 ms)')).not.toBeNull();
  expect(screen.getByRole('row', { name: /Nocturna Fallida/ })).not.toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sincronizar ahora' }));
  expect((await screen.findByRole('status')).textContent).toContain('3 alta(s), 1 baja(s), 1 sin cuenta');
  expect(fetcher.mock.calls.some(([url, init]) => url === '/api/enrollments/registry/sync' && init?.method === 'POST')).toBe(true);
});
test('administrator sees merged latency per route, outbox queues, replicas, jobs and threshold alerts', async () => {
  const route = { method: 'PUT', route: '/api/exams/attempts/:id/answers/:questionId', count: 400, errors: 0, errorRatePct: 0, p50Ms: 300, p95Ms: 1500, avgMs: 350 };
  const panel: MonitoringPanel = { window: { minutes: 15, from: '', generatedAt: '' }, thresholds: { p95Ms: 1000, errorRatePct: 5, minRequests: 20, outboxAgeSeconds: 120 },
    total: { ...route, method: '*', route: '*', p95Ms: 750 }, routes: [route, { ...route, route: '/api/health/ready', count: 3, p95Ms: null }],
    outboxes: { 'Calificación automática (exams)': { pending: 4, failing: 1, oldestPendingSeconds: 12 } }, activeAttempts: 37,
    replicas: [{ id: 'api-1', startedAt: '', lastSeenAt: '2026-11-20T10:00:00.000Z', alive: true }, { id: 'api-2', startedAt: '', lastSeenAt: '2026-11-20T09:50:00.000Z', alive: false }],
    jobs: [{ name: 'Sincronización nocturna del registro', state: 'FALLIDA', detail: 'REGISTRY_UNAVAILABLE' }], lastSync: null,
    alerts: [{ key: 'k', title: 'Latencia alta: PUT /api/exams/attempts/:id/answers/:questionId', body: 'p95 1500 ms supera el umbral de 1000 ms (400 solicitudes).' }] };
  const fetcher = vi.fn(async (_url: string) => json(panel)); vi.stubGlobal('fetch', fetcher);
  render(<MonitoringView token="jwt" failed={vi.fn()} />);
  expect(await screen.findByText('p95 global: 750 ms')).not.toBeNull();
  expect(screen.getByText(/Intentos de examen activos: 37 · Réplicas activas: 1\/2/)).not.toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Latencia alta');
  expect(screen.getByRole('row', { name: /Sincronización nocturna del registro Fallida/ })).not.toBeNull();
  expect(screen.getByRole('row', { name: /api-2 Sin latido/ })).not.toBeNull();
  expect(screen.getByRole('row', { name: /health\/ready 3 300 ms > 10 s/ })).not.toBeNull();
  await userEvent.setup().selectOptions(screen.getByLabelText('Ventana de tiempo'), '60');
  expect(fetcher.mock.calls.some(([url]) => String(url) === '/api/administration/monitoring?minutes=60')).toBe(true);
});
test('a failed manual run explains the retries and the alert', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => json(init?.method === 'POST' ? { ...failedRun, trigger: 'MANUAL' }
    : { ...overview, registry: { ...overview.registry, mode: 'down' } })));
  render(<RegistryView token="jwt" failed={vi.fn()} />);
  expect(await screen.findByText('No disponible (down)')).not.toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Sincronizar ahora' }));
  expect((await screen.findByRole('status')).textContent).toContain('falló tras 3 reintento(s)');
});
