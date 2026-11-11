import { DynamicModule, Module } from '@nestjs/common';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { REGISTRY_SYNC_STATUS, type RegistrySyncStatus } from '../enrollments/public';
import { NOTIFICATION_SENDER, type NotificationSender } from '../collaboration/public';
import { AlertService } from './application/alert-service';
import { AlertJob } from './infrastructure/jobs/alert-job';

@Module({})
export class AdministrationModule {
  static register(imports: DynamicModule[], config: { alertIntervalMs?: number }): DynamicModule {
    return { module: AdministrationModule, imports, providers: [
      { provide: AlertService, inject: [IDENTITY_DIRECTORY, NOTIFICATION_SENDER, REGISTRY_SYNC_STATUS],
        useFactory: (identity: IdentityDirectory, notifications: NotificationSender, registry: RegistrySyncStatus) => new AlertService(
          { administrators: () => identity.listAdministrators() },
          { send: deliveries => notifications.notify(deliveries.map(({ userId, alert }) => ({ userId, type: 'SYSTEM_ALERT', title: alert.title,
            body: alert.body, link: { view: 'operations' }, dedupeKey: `${alert.key}:${userId}`.slice(0, 200) }))) },
          { recentRuns: limit => registry.recentRuns(limit) }, { now: () => new Date().toISOString() }) },
      { provide: AlertJob, inject: [AlertService], useFactory: (alerts: AlertService) => new AlertJob(alerts, config.alertIntervalMs) },
    ] };
  }
}
