import type { AuditService } from '../../application/audit-service';

/** Periodic anchoring of the audit chain head (single backend, ADR-001); idempotent across replicas. */
export class AuditAnchorJob {
  private timer?: NodeJS.Timeout;
  private running: Promise<unknown> | null = null;
  constructor(private readonly audit: AuditService, private readonly intervalMs = 600_000) {}
  onApplicationBootstrap(): void {
    const run = () => {
      if (!this.running) this.running = this.audit.anchor().catch(() => {
        console.error('Audit anchoring unavailable; it will be retried on the next run.');
      }).finally(() => { this.running = null; });
    };
    run(); this.timer = setInterval(run, this.intervalMs); this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> { clearInterval(this.timer); await this.running; }
}
