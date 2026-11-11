import type { ExamService } from '../../application/exam-service';
import type { PrismaExamRepository } from '../persistence/prisma-exam-repository';

/**
 * In-process worker of the single deployable backend (no separate Worker, ADR-001): closes expired attempts (A2) and
 * consumes AttemptFinalized from the outbox to grade them. Every step is atomic and replica-safe (SKIP LOCKED).
 */
export class ExamJobs {
  private timer?: NodeJS.Timeout;
  private running: Promise<void> | null = null;
  constructor(private readonly exams: ExamService, private readonly repo: PrismaExamRepository, private readonly intervalMs = 2000) {}
  async tick(): Promise<void> {
    await this.exams.expire(200);
    for (let processed = 0; processed < 50; processed++) {
      if (!await this.repo.processNext(payload => this.exams.handleFinalized({ attemptId: String(payload.attemptId) }))) break;
    }
  }
  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (!this.running) this.running = this.tick().catch(() => {
        console.error('Exam jobs unavailable; expired attempts and pending grades are retried on the next tick.');
      }).finally(() => { this.running = null; });
    }, this.intervalMs);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> { clearInterval(this.timer); await this.running; }
}
