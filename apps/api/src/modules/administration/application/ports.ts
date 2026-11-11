import type { OperationalAlert, SyncRunFact } from '../domain/alerts';
import type { Backlog, MetricRow } from '../domain/metrics';
export interface AlertRecipients { administrators(): Promise<{ id: string }[]> }
export interface AlertSink { send(alerts: readonly { userId: string; alert: OperationalAlert }[]): Promise<void> }
export interface RegistryRunsSource { recentRuns(limit: number): Promise<SyncRunFact[]> }
export interface AdministrationRuntime { now(): string }

export interface MetricsRepository {
  /** Adds the drained per-replica rows (upsert summing counts and histogram buckets). */
  add(instance: string, rows: readonly MetricRow[]): Promise<void>;
  since(fromIso: string): Promise<MetricRow[]>;
  heartbeat(instance: string, startedAt: string): Promise<void>;
  instances(): Promise<{ id: string; startedAt: string; lastSeenAt: string }[]>;
  prune(beforeIso: string): Promise<void>;
}
/** Read-only facts from other modules' contracts (exams, submissions, audit). */
export interface OperationsSources {
  exams(): Promise<{ activeAttempts: number; outbox: Backlog }>;
  submissions(): Promise<Backlog>;
  lastAnchor(): Promise<{ entryId: string; anchoredAt: string } | null>;
}
export interface MonitoringDirectory { role(id: string): Promise<string | null> }
