import { breaches, MetricsAccumulator, minuteOf, summarize, type Thresholds } from '../domain/metrics';
import type { OperationalAlert } from '../domain/alerts';
import type { AdministrationRuntime, MetricsRepository, MonitoringDirectory, OperationsSources, RegistryRunsSource } from './ports';

export class MonitoringError extends Error { constructor(readonly code: 'FORBIDDEN' | 'INVALID_INPUT') { super(code); } }
const ALERT_WINDOW_MINUTES = 5;
const INSTANCE_ALIVE_MS = 60_000;
const RETENTION_MS = 24 * 3_600_000;

/**
 * CU-14 / CAR-14: performance panel for administrators. Each replica measures its own requests in memory and flushes
 * them to PostgreSQL; the panel merges all replicas. Threshold breaches become inbox alerts through AlertService.
 */
export class MonitoringService {
  readonly accumulator = new MetricsAccumulator();
  private readonly startedAt: string;
  constructor(private readonly repo: MetricsRepository, private readonly sources: OperationsSources, private readonly registry: RegistryRunsSource,
    private readonly directory: MonitoringDirectory, private readonly runtime: AdministrationRuntime, readonly instance: string, readonly thresholds: Thresholds) {
    this.startedAt = runtime.now();
  }
  record(sample: { method: string; route: string; status: number; durationMs: number }): void { this.accumulator.record({ ...sample, at: this.runtime.now() }); }

  /** Flush job: persists the drained rows (restored on failure), refreshes this replica's heartbeat and prunes old data. */
  async flush(): Promise<number> {
    const rows = this.accumulator.drain();
    try { if (rows.length) await this.repo.add(this.instance, rows); } catch (error) { this.accumulator.restore(rows); throw error; }
    await this.repo.heartbeat(this.instance, this.startedAt);
    await this.repo.prune(new Date(new Date(this.runtime.now()).getTime() - RETENTION_MS).toISOString());
    return rows.length;
  }
  private window(minutes: number) {
    const now = new Date(this.runtime.now()).getTime();
    return { from: minuteOf(new Date(now - (minutes - 1) * 60_000).toISOString()), now };
  }
  async dashboard(actorId: string, minutes = 15) {
    if (await this.directory.role(actorId) !== 'ADMIN') throw new MonitoringError('FORBIDDEN');
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new MonitoringError('INVALID_INPUT');
    const { from, now } = this.window(minutes);
    const [rows, exams, submissions, runs, anchor, instances] = await Promise.all([this.repo.since(from), this.sources.exams(), this.sources.submissions(),
      this.registry.recentRuns(1), this.sources.lastAnchor(), this.repo.instances()]);
    const summary = summarize(rows);
    const outboxes = { 'Calificación automática (exams)': exams.outbox, 'Control de plagio (submissions)': submissions };
    const lastSync = runs[0] ?? null;
    const age = (iso: string | null | undefined) => iso ? Math.round((now - new Date(iso).getTime()) / 1000) : null;
    const backlogState = (backlog: { oldestPendingSeconds: number | null; failing: number }) => (backlog.oldestPendingSeconds ?? 0) > this.thresholds.outboxAgeSeconds ? 'ATRASADO' : backlog.failing ? 'REINTENTANDO' : 'OK';
    return {
      window: { minutes, from, generatedAt: new Date(now).toISOString() }, thresholds: this.thresholds,
      total: summary.total, routes: summary.routes.slice(0, 30), outboxes, activeAttempts: exams.activeAttempts,
      replicas: instances.map(item => ({ ...item, alive: now - new Date(item.lastSeenAt).getTime() <= INSTANCE_ALIVE_MS })),
      jobs: [
        { name: 'Calificación automática (outbox exams)', state: backlogState(exams.outbox), detail: `${exams.outbox.pending} pendiente(s)` },
        { name: 'Control de plagio (outbox submissions)', state: backlogState(submissions), detail: `${submissions.pending} pendiente(s)` },
        { name: 'Sincronización nocturna del registro', state: !lastSync ? 'SIN_EJECUCIONES' : lastSync.status === 'FAILED' ? 'FALLIDA' : lastSync.status === 'RUNNING' ? 'EN_CURSO' : 'OK',
          detail: lastSync ? `${lastSync.trigger === 'SCHEDULED' ? 'Nocturna' : 'Manual'} hace ${age(lastSync.startedAt)} s${lastSync.error ? ` · ${lastSync.error}` : ''}` : 'Programada 02:00 America/Lima' },
        { name: 'Anclaje de auditoría', state: anchor ? 'OK' : 'SIN_ANCLAJES', detail: anchor ? `Entrada #${anchor.entryId} hace ${age(anchor.anchoredAt)} s` : 'Aún no hay entradas ancladas' },
      ],
      lastSync, alerts: breaches(summary, outboxes, this.thresholds, from),
    };
  }
  /** Alert source: breaches over the last minutes, keyed per window (one alert per window and route). */
  async alerts(): Promise<OperationalAlert[]> {
    const { from } = this.window(ALERT_WINDOW_MINUTES);
    const [rows, exams, submissions] = await Promise.all([this.repo.since(from), this.sources.exams(), this.sources.submissions()]);
    const windowKey = minuteOf(new Date(Math.floor(new Date(from).getTime() / (ALERT_WINDOW_MINUTES * 60_000)) * ALERT_WINDOW_MINUTES * 60_000).toISOString());
    return breaches(summarize(rows), { 'Calificación automática (exams)': exams.outbox, 'Control de plagio (submissions)': submissions }, this.thresholds, windowKey);
  }
}
