import type { MonitoringService } from '../../application/monitoring-service';

/** Flushes this replica's request metrics and heartbeat every few seconds (single backend, ADR-001). */
export class MetricsFlushJob {
  private timer?: NodeJS.Timeout;
  private running: Promise<unknown> | null = null;
  constructor(private readonly monitoring: MonitoringService, private readonly intervalMs = 10_000) {}
  private run(): Promise<unknown> {
    if (!this.running) this.running = this.monitoring.flush().catch(() => {
      console.error('Metrics flush unavailable; samples are kept in memory and retried.');
    }).finally(() => { this.running = null; });
    return this.running;
  }
  onApplicationBootstrap(): void { void this.run(); this.timer = setInterval(() => void this.run(), this.intervalMs); this.timer.unref(); }
  async onModuleDestroy(): Promise<void> { clearInterval(this.timer); await this.running; await this.run(); }
}
