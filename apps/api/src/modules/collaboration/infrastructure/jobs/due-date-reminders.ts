import type { CollaborationService } from '../../application/collaboration-service';

/** In-process scheduler of the single backend: due-date reminders are idempotent, so overlapping runs or replicas are safe. */
export class DueDateReminders {
  private timer?: NodeJS.Timeout;
  private running: Promise<unknown> | null = null;
  constructor(private readonly collaboration: CollaborationService, private readonly intervalMs = 300_000) {}
  onApplicationBootstrap(): void {
    const run = () => {
      if (!this.running) this.running = this.collaboration.remindDueSoon().catch(() => {
        console.error('Due-date reminders unavailable; they will be retried on the next run.');
      }).finally(() => { this.running = null; });
    };
    run(); this.timer = setInterval(run, this.intervalMs); this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> { clearInterval(this.timer); await this.running; }
}
