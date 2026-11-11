import { DynamicModule, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { hostname } from 'node:os';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from '../identity/public';
import { REGISTRY_SYNC_STATUS, type RegistrySyncStatus } from '../enrollments/public';
import { NOTIFICATION_SENDER, type NotificationSender } from '../collaboration/public';
import { EXAM_MONITOR, type ExamMonitor } from '../exams/public';
import { SUBMISSION_EVENTS, type SubmissionEvents } from '../submissions/public';
import { AUDIT_ANCHOR_STATUS, type AuditAnchorStatus } from '../audit/public';
import { BearerGuard } from '../../platform/http/bearer-guard';
import { AlertService } from './application/alert-service';
import { MonitoringService } from './application/monitoring-service';
import { DEFAULT_THRESHOLDS, type Thresholds } from './domain/metrics';
import { MetricsMiddleware, MonitoringController } from './infrastructure/http/monitoring.http';
import { AlertJob } from './infrastructure/jobs/alert-job';
import { MetricsFlushJob } from './infrastructure/jobs/metrics-flush-job';
import { PrismaMetricsRepository } from './infrastructure/persistence/prisma-metrics-repository';

export interface AdministrationConfig { databaseUrl: string; alertIntervalMs?: number; metricsFlushMs?: number; thresholds?: Partial<Thresholds>; instanceId?: string }

@Module({})
export class AdministrationModule implements NestModule {
  static register(imports: DynamicModule[], config: AdministrationConfig): DynamicModule {
    const instance = (config.instanceId ?? `${hostname()}-${process.pid}`).slice(0, 80);
    return { module: AdministrationModule, imports, controllers: [MonitoringController], providers: [
      { provide: PrismaMetricsRepository, useFactory: () => new PrismaMetricsRepository(config.databaseUrl) },
      { provide: MonitoringService, inject: [PrismaMetricsRepository, IDENTITY_DIRECTORY, REGISTRY_SYNC_STATUS, EXAM_MONITOR, SUBMISSION_EVENTS, AUDIT_ANCHOR_STATUS],
        useFactory: (repo: PrismaMetricsRepository, identity: IdentityDirectory, registry: RegistrySyncStatus, exams: ExamMonitor, submissions: SubmissionEvents, audit: AuditAnchorStatus) =>
          new MonitoringService(repo, { exams: () => exams.snapshot(), submissions: () => submissions.backlog(), lastAnchor: () => audit.lastAnchor() },
            { recentRuns: limit => registry.recentRuns(limit) }, { role: async id => (await identity.findPrincipal(id))?.role ?? null },
            { now: () => new Date().toISOString() }, instance, { ...DEFAULT_THRESHOLDS, ...config.thresholds }) },
      { provide: AlertService, inject: [IDENTITY_DIRECTORY, NOTIFICATION_SENDER, REGISTRY_SYNC_STATUS, MonitoringService],
        useFactory: (identity: IdentityDirectory, notifications: NotificationSender, registry: RegistrySyncStatus, monitoring: MonitoringService) => {
          const alerts = new AlertService(
            { administrators: () => identity.listAdministrators() },
            { send: deliveries => notifications.notify(deliveries.map(({ userId, alert }) => ({ userId, type: 'SYSTEM_ALERT', title: alert.title.slice(0, 200),
              body: alert.body.slice(0, 1000), link: { view: 'operations' }, dedupeKey: `${alert.key}:${userId}`.slice(0, 200) }))) },
            { recentRuns: limit => registry.recentRuns(limit) }, { now: () => new Date().toISOString() });
          alerts.addSource(() => monitoring.alerts());
          return alerts;
        } },
      { provide: AlertJob, inject: [AlertService], useFactory: (alerts: AlertService) => new AlertJob(alerts, config.alertIntervalMs) },
      { provide: MetricsFlushJob, inject: [MonitoringService], useFactory: (monitoring: MonitoringService) => new MetricsFlushJob(monitoring, config.metricsFlushMs) },
      MetricsMiddleware, BearerGuard,
    ] };
  }
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MetricsMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
