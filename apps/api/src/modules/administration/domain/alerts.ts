/** Operational alerts for administrators (EAC-06, CAR-14). Pure rules: which facts deserve an alert and its stable key. */
export interface OperationalAlert { readonly key: string; readonly title: string; readonly body: string }
export interface SyncRunFact {
  readonly id: string; readonly status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'; readonly trigger: 'SCHEDULED' | 'MANUAL';
  readonly startedAt: string; readonly error: string | null; readonly retries: number;
}
/** Look-back window: a failure is alerted while it is recent; the dedupe key makes each one reach the inbox once. */
export const ALERT_WINDOW_MS = 24 * 3_600_000;

export function registryAlerts(runs: readonly SyncRunFact[], nowIso: string): OperationalAlert[] {
  const since = new Date(nowIso).getTime() - ALERT_WINDOW_MS;
  return runs.filter(run => run.status === 'FAILED' && new Date(run.startedAt).getTime() >= since).map(run => ({
    key: `REGISTRY_SYNC_FAILED:${run.id}`,
    title: 'Falló la sincronización con el Registro Académico',
    body: `${run.trigger === 'SCHEDULED' ? 'Ejecución nocturna' : 'Ejecución manual'} del ${new Date(run.startedAt).toLocaleString('es-PE', { timeZone: 'America/Lima' })}: ${run.error ?? 'error'} tras ${run.retries} reintento(s). El LMS sigue operando con la última lista sincronizada.`,
  }));
}
