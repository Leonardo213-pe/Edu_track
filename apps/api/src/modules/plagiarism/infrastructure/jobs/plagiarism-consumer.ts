import type { PlagiarismService } from '../../application/plagiarism-service';
import type { SubmissionEvents } from '../../../submissions/public';

/**
 * In-process asynchronous consumer of the submissions outbox (single backend, ADR-001). SKIP LOCKED gives each event to
 * one replica; failures are retried with backoff by the outbox; the service is idempotent per file.
 */
export class PlagiarismConsumer {
  private timer?: NodeJS.Timeout;
  private running: Promise<void> | null = null;
  constructor(private readonly events: SubmissionEvents, private readonly plagiarism: PlagiarismService, private readonly intervalMs = 2000) {}
  async tick(): Promise<void> {
    for (let processed = 0; processed < 50; processed++) if (!await this.events.processNext(event => this.plagiarism.handle(event))) break;
  }
  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (!this.running) this.running = this.tick().catch(() => {
        console.error('Plagiarism consumer unavailable; pending submissions are retried on the next tick.');
      }).finally(() => { this.running = null; });
    }, this.intervalMs);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> { clearInterval(this.timer); await this.running; }
}
