import { registryAlerts, type OperationalAlert } from '../domain/alerts';
import type { AdministrationRuntime, AlertRecipients, AlertSink, RegistryRunsSource } from './ports';

/**
 * Turns operational facts into inbox alerts for every active administrator. Idempotent: each alert carries a stable
 * key, so repeated checks or several replicas never notify twice.
 */
export class AlertService {
  private readonly extra: (() => Promise<OperationalAlert[]>)[] = [];
  constructor(private readonly recipients: AlertRecipients, private readonly sink: AlertSink, private readonly registry: RegistryRunsSource,
    private readonly runtime: AdministrationRuntime) {}
  /** Additional alert sources (monitoring thresholds). */
  addSource(source: () => Promise<OperationalAlert[]>): void { this.extra.push(source); }
  async check(): Promise<number> {
    const alerts = registryAlerts(await this.registry.recentRuns(20), this.runtime.now());
    for (const source of this.extra) alerts.push(...await source());
    if (!alerts.length) return 0;
    const admins = await this.recipients.administrators();
    const deliveries = admins.flatMap(admin => alerts.map(alert => ({ userId: admin.id, alert })));
    if (deliveries.length) await this.sink.send(deliveries);
    return deliveries.length;
  }
}
