import type { RegistrySyncService } from '../../application/registry-sync-service';

/**
 * In-process scheduler of the single backend (ADR-001): checks every minute whether the nightly 02:00 America/Lima run
 * is due. The unique daily slot in PostgreSQL makes it run once across replicas; a failure never stops the API.
 */
export class RegistrySyncScheduler {
  private timer?: NodeJS.Timeout;
  private running: Promise<unknown> | null = null;
  constructor(private readonly sync: RegistrySyncService, private readonly intervalMs = 60_000) {}
  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (!this.running) this.running = this.sync.runScheduled().catch(() => {
        console.error('Registry synchronization scheduler unavailable; it will be retried on the next tick.');
      }).finally(() => { this.running = null; });
    }, this.intervalMs);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> { clearInterval(this.timer); await this.running; }
}
