import type { AlertService } from '../../application/alert-service';

/** In-process periodic check of the single backend (ADR-001). Alerts are idempotent, so replicas may overlap safely. */
export class AlertJob {
  private timer?: NodeJS.Timeout;
  private running: Promise<unknown> | null = null;
  constructor(private readonly alerts: AlertService, private readonly intervalMs = 60_000) {}
  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (!this.running) this.running = this.alerts.check().catch(() => {
        console.error('Operational alerts unavailable; they will be retried on the next check.');
      }).finally(() => { this.running = null; });
    }, this.intervalMs);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> { clearInterval(this.timer); await this.running; }
}
