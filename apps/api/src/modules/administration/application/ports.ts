import type { OperationalAlert, SyncRunFact } from '../domain/alerts';
export interface AlertRecipients { administrators(): Promise<{ id: string }[]> }
export interface AlertSink { send(alerts: readonly { userId: string; alert: OperationalAlert }[]): Promise<void> }
export interface RegistryRunsSource { recentRuns(limit: number): Promise<SyncRunFact[]> }
export interface AdministrationRuntime { now(): string }
