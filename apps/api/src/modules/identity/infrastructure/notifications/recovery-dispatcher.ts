export class RecoveryDispatcher {
  private timer?: NodeJS.Timeout;
  private running: Promise<void> | null = null;
  constructor(private readonly deliver: () => Promise<void>) {}
  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (!this.running) this.running = this.deliver().catch(() => {
        console.error('Identity recovery dispatcher unavailable; pending deliveries retained.');
      }).finally(() => { this.running = null; });
    }, 2000); this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> { clearInterval(this.timer); await this.running; }
}
