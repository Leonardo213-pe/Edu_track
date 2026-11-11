import { useEffect, useState } from 'react';
import { evaluationApi } from './assessments-api';

interface RouteSummary { method: string; route: string; count: number; errors: number; errorRatePct: number; p50Ms: number | null; p95Ms: number | null; avgMs: number }
interface Backlog { pending: number; failing: number; oldestPendingSeconds: number | null }
export interface MonitoringPanel {
  window: { minutes: number; from: string; generatedAt: string };
  thresholds: { p95Ms: number; errorRatePct: number; minRequests: number; outboxAgeSeconds: number };
  total: RouteSummary; routes: RouteSummary[]; outboxes: Record<string, Backlog>; activeAttempts: number;
  replicas: { id: string; startedAt: string; lastSeenAt: string; alive: boolean }[];
  jobs: { name: string; state: string; detail: string }[];
  lastSync: { status: string; startedAt: string; error: string | null } | null;
  alerts: { key: string; title: string; body: string }[];
}
// p95 above the last histogram bound is serialized as null while there is traffic.
const latency = (value: number | null, count: number) => value === null ? (count ? '> 10 s' : '—') : `${value} ms`;
const states: Record<string, string> = { OK: 'Correcto', REINTENTANDO: 'Reintentando', ATRASADO: 'Atrasado', FALLIDA: 'Fallida', EN_CURSO: 'En curso', SIN_EJECUCIONES: 'Sin ejecuciones', SIN_ANCLAJES: 'Sin anclajes' };

/** CU-14 / CAR-14: performance and operations panel for administrators, merged across API replicas. */
export function MonitoringView({ token, failed }: { token: string; failed(error: unknown): void }) {
  const [minutes, setMinutes] = useState(15); const [data, setData] = useState<MonitoringPanel | null>(null);
  async function load() { try { setData(await evaluationApi<MonitoringPanel>(`/administration/monitoring?minutes=${minutes}`, token)); } catch (error) { failed(error); } }
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15_000); return () => clearInterval(timer); }, [minutes]);
  return <section className="panel"><span className="eyebrow">CAR-14 · MONITOREO</span><h2>Rendimiento y operación</h2>
    <p className="muted">Métricas de todas las réplicas de la API (latencia por ruta, errores 5xx), colas de outbox, intentos activos y trabajos en segundo plano. Se actualiza cada 15 s; los umbrales generan alertas en la bandeja de los administradores.</p>
    <div className="inline-actions"><label>Ventana<select aria-label="Ventana de tiempo" value={minutes} onChange={event => setMinutes(Number(event.target.value))}>
      {[5, 15, 60, 1440].map(value => <option key={value} value={value}>{value < 60 ? `${value} min` : value === 60 ? '1 h' : '24 h'}</option>)}</select></label>
      <button className="quiet" onClick={() => void load()}>Actualizar</button></div>
    {!data ? <p role="status">Cargando métricas…</p> : <>
      <div className="grade-summary" aria-label="Resumen">
        <strong>p95 global: {latency(data.total.p95Ms, data.total.count)}</strong>
        <span>p50 {latency(data.total.p50Ms, data.total.count)} · {data.total.count} solicitudes · errores {data.total.errorRatePct} %</span>
        <small>Intentos de examen activos: {data.activeAttempts} · Réplicas activas: {data.replicas.filter(replica => replica.alive).length}/{data.replicas.length}</small>
      </div>
      {data.alerts.length > 0 ? <div role="alert" className="message">{data.alerts.map(alert => <p key={alert.key}><strong>{alert.title}.</strong> {alert.body}</p>)}</div>
        : <p className="success">Sin umbrales superados (p95 ≤ {data.thresholds.p95Ms} ms, errores ≤ {data.thresholds.errorRatePct} %, colas ≤ {data.thresholds.outboxAgeSeconds} s).</p>}
      <h3>Trabajos en segundo plano</h3>
      <div className="table-scroll"><table><thead><tr><th>Trabajo</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>
        {data.jobs.map(job => <tr key={job.name}><td>{job.name}</td><td>{states[job.state] ?? job.state}</td><td>{job.detail}</td></tr>)}</tbody></table></div>
      <h3>Colas de outbox</h3>
      <div className="table-scroll"><table><thead><tr><th>Cola</th><th>Pendientes</th><th>Con reintentos</th><th>Más antiguo</th></tr></thead><tbody>
        {Object.entries(data.outboxes).map(([name, backlog]) => <tr key={name}><td>{name}</td><td>{backlog.pending}</td><td>{backlog.failing}</td><td>{backlog.oldestPendingSeconds === null ? '—' : `${backlog.oldestPendingSeconds} s`}</td></tr>)}</tbody></table></div>
      <h3>Réplicas de la API</h3>
      <div className="table-scroll"><table><thead><tr><th>Réplica</th><th>Estado</th><th>Último latido</th></tr></thead><tbody>
        {data.replicas.map(replica => <tr key={replica.id}><td>{replica.id}</td><td>{replica.alive ? 'Activa' : 'Sin latido'}</td><td>{new Date(replica.lastSeenAt).toLocaleTimeString('es-PE')}</td></tr>)}</tbody></table></div>
      <h3>Latencia por ruta</h3>
      {!data.routes.length ? <p className="muted">Sin solicitudes en la ventana.</p> : <div className="table-scroll"><table><thead><tr><th>Ruta</th><th>Solicitudes</th><th>p50</th><th>p95</th><th>Errores 5xx</th></tr></thead><tbody>
        {data.routes.map(route => <tr key={`${route.method} ${route.route}`}><td><code>{route.method} {route.route}</code></td><td>{route.count}</td><td>{latency(route.p50Ms, route.count)}</td>
          <td className={route.p95Ms === null || route.p95Ms > data.thresholds.p95Ms ? 'danger' : undefined}>{latency(route.p95Ms, route.count)}</td><td>{route.errorRatePct} %</td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}
