import type { OperationalAlert } from './alerts';

/** Request metrics (CAR-14, EAC-01/02). Fixed latency histogram so replicas can be merged exactly. Pure rules. */
export const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2500, 5000, 10000] as const;
/** One more slot for observations above the last bound. */
export const BUCKET_COUNT = LATENCY_BUCKETS_MS.length + 1;

export interface MetricRow { minute: string; method: string; route: string; count: number; errors: number; totalMs: number; buckets: number[] }
export function bucketIndex(ms: number): number {
  const index = LATENCY_BUCKETS_MS.findIndex(bound => ms <= bound); return index < 0 ? LATENCY_BUCKETS_MS.length : index;
}
/** Upper bound of the bucket holding the q-quantile (conservative: never underestimates); null without data. */
export function quantile(buckets: readonly number[], q: number): number | null {
  const total = buckets.reduce((sum, value) => sum + value, 0); if (!total) return null;
  const rank = Math.ceil(q * total); let seen = 0;
  for (let i = 0; i < buckets.length; i++) { seen += buckets[i]!; if (seen >= rank) return i < LATENCY_BUCKETS_MS.length ? LATENCY_BUCKETS_MS[i]! : Infinity; }
  return Infinity;
}
export function minuteOf(iso: string): string { const date = new Date(iso); date.setUTCSeconds(0, 0); return date.toISOString(); }

/** Per-replica accumulator: requests are summed by minute, method and route template and drained by the flush job. */
export class MetricsAccumulator {
  private rows = new Map<string, MetricRow>();
  record(sample: { method: string; route: string; status: number; durationMs: number; at: string }): void {
    const minute = minuteOf(sample.at); const key = `${minute} ${sample.method} ${sample.route}`;
    let row = this.rows.get(key);
    if (!row) { row = { minute, method: sample.method, route: sample.route, count: 0, errors: 0, totalMs: 0, buckets: new Array(BUCKET_COUNT).fill(0) }; this.rows.set(key, row); }
    row.count++; row.totalMs += Math.max(0, Math.round(sample.durationMs)); row.buckets[bucketIndex(sample.durationMs)]!++;
    if (sample.status >= 500) row.errors++;
  }
  drain(): MetricRow[] { const rows = [...this.rows.values()]; this.rows = new Map(); return rows; }
  /** Puts back rows whose flush failed so no sample is lost. */
  restore(rows: readonly MetricRow[]): void {
    for (const row of rows) {
      const key = `${row.minute} ${row.method} ${row.route}`; const current = this.rows.get(key);
      if (!current) { this.rows.set(key, { ...row, buckets: [...row.buckets] }); continue; }
      current.count += row.count; current.errors += row.errors; current.totalMs += row.totalMs; row.buckets.forEach((value, i) => { current.buckets[i]! += value; });
    }
  }
}

export interface RouteSummary { method: string; route: string; count: number; errors: number; errorRatePct: number; p50Ms: number | null; p95Ms: number | null; avgMs: number }
export function summarize(rows: readonly MetricRow[]): { routes: RouteSummary[]; total: RouteSummary } {
  const groups = new Map<string, MetricRow>();
  const all: MetricRow = { minute: '', method: '*', route: '*', count: 0, errors: 0, totalMs: 0, buckets: new Array(BUCKET_COUNT).fill(0) };
  for (const row of rows) {
    const key = `${row.method} ${row.route}`;
    const group = groups.get(key) ?? { ...row, count: 0, errors: 0, totalMs: 0, buckets: new Array(BUCKET_COUNT).fill(0) }; groups.set(key, group);
    for (const target of [group, all]) { target.count += row.count; target.errors += row.errors; target.totalMs += row.totalMs; row.buckets.forEach((value, i) => { target.buckets[i]! += value; }); }
  }
  const view = (row: MetricRow): RouteSummary => ({ method: row.method, route: row.route, count: row.count, errors: row.errors,
    errorRatePct: row.count ? Math.round(row.errors * 10_000 / row.count) / 100 : 0, p50Ms: quantile(row.buckets, 0.5), p95Ms: quantile(row.buckets, 0.95),
    avgMs: row.count ? Math.round(row.totalMs / row.count) : 0 });
  return { routes: [...groups.values()].map(view).sort((a, b) => b.count - a.count), total: view(all) };
}

export interface Thresholds { p95Ms: number; errorRatePct: number; minRequests: number; outboxAgeSeconds: number }
/** p95 ≤ 1 s is the EAC-01 objective; the error and backlog thresholds are operational defaults, configurable. */
export const DEFAULT_THRESHOLDS: Thresholds = { p95Ms: 1000, errorRatePct: 5, minRequests: 20, outboxAgeSeconds: 120 };
export interface Backlog { pending: number; failing: number; oldestPendingSeconds: number | null }

/** Breaches in the evaluated window. The key carries the window start so a persisting breach alerts once per window. */
export function breaches(summary: { routes: RouteSummary[]; total: RouteSummary }, outboxes: Record<string, Backlog>, thresholds: Thresholds, windowStart: string): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  for (const route of summary.routes) if (route.count >= thresholds.minRequests && route.p95Ms !== null && route.p95Ms > thresholds.p95Ms)
    alerts.push({ key: `P95:${route.method}:${route.route}:${windowStart}`, title: `Latencia alta: ${route.method} ${route.route}`,
      body: `p95 ${Number.isFinite(route.p95Ms) ? `${route.p95Ms} ms` : '> 10 s'} supera el umbral de ${thresholds.p95Ms} ms (${route.count} solicitudes).` });
  if (summary.total.count >= thresholds.minRequests && summary.total.errorRatePct > thresholds.errorRatePct)
    alerts.push({ key: `ERRORS:${windowStart}`, title: 'Tasa de errores alta', body: `${summary.total.errorRatePct} % de respuestas 5xx supera el umbral de ${thresholds.errorRatePct} %.` });
  for (const [name, backlog] of Object.entries(outboxes)) if ((backlog.oldestPendingSeconds ?? 0) > thresholds.outboxAgeSeconds)
    alerts.push({ key: `OUTBOX:${name}:${windowStart}`, title: `Cola atrasada: ${name}`,
      body: `${backlog.pending} evento(s) pendientes (${backlog.failing} con reintentos); el más antiguo espera ${backlog.oldestPendingSeconds} s (umbral ${thresholds.outboxAgeSeconds} s).` });
  return alerts;
}
