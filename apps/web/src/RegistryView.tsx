import { useEffect, useState } from 'react';
import { evaluationApi } from './assessments-api';

export interface RegistryRun {
  id: string; trigger: 'SCHEDULED' | 'MANUAL'; status: 'RUNNING' | 'SUCCEEDED' | 'FAILED'; startedAt: string; finishedAt: string | null;
  sections: number; added: number; removed: number; unknown: number; skipped: number; retries: number; error: string | null;
}
export interface RegistryOverview {
  registry: { configured: boolean; reachable: boolean; simulated: boolean; mode: string; latencyMs: number | null; checkedAt: string };
  runs: RegistryRun[]; sections: number; schedule: { time: string; timeZone: string };
}
const statuses = { RUNNING: 'En curso', SUCCEEDED: 'Correcta', FAILED: 'Fallida' };
const lima = (iso: string) => new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima' });

/** CU-12: the administrator checks the Academic Registry (SIMULATED locally), its nightly runs and synchronizes on demand. */
export function RegistryView({ token, failed }: { token: string; failed(error: unknown): void }) {
  const [data, setData] = useState<RegistryOverview | null>(null);
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<RegistryRun | null>(null);
  async function load() { try { setData(await evaluationApi<RegistryOverview>('/enrollments/registry', token)); } catch (error) { failed(error); } }
  useEffect(() => { void load(); }, []);
  async function sync() {
    setBusy(true); setResult(null);
    try { setResult(await evaluationApi<RegistryRun>('/enrollments/registry/sync', token, {})); await load(); } catch (error) { failed(error); } finally { setBusy(false); }
  }
  const registry = data?.registry;
  return <section className="panel"><span className="eyebrow">CAR-09 · MATRÍCULAS NOCTURNAS</span><h2>Registro Académico</h2>
    <p className="muted">EduTrack solo consume la lista oficial de inscritos. Cada noche a las {data?.schedule.time ?? '02:00'} ({data?.schedule.timeZone ?? 'America/Lima'}) se concilian altas y bajas de cada curso vinculado por código y período, con hasta 3 reintentos; si falla se avisa a los administradores sin afectar al LMS.</p>
    {!data ? <p role="status">Cargando estado…</p> : <>
      <div className="inline-actions" aria-label="Estado del registro">
        {registry!.simulated && <span className="role-badge" title="Servicio de demostración local, no es el registro institucional">SIMULADO</span>}
        <span>{!registry!.configured ? 'Registro no configurado' : registry!.reachable && registry!.mode === 'up' ? `Disponible (${registry!.latencyMs} ms)` : `No disponible (${registry!.mode})`}</span>
        <span className="muted">{data.sections} curso(s) vinculados</span>
        <button className="primary" disabled={busy || !registry!.configured} onClick={sync}>{busy ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
      </div>
      {result && <p role="status" className={result.status === 'SUCCEEDED' ? 'success' : 'message'}>{result.status === 'SUCCEEDED'
        ? `Sincronización correcta: ${result.sections} sección(es), ${result.added} alta(s), ${result.removed} baja(s), ${result.unknown} sin cuenta en el LMS, ${result.skipped} sin sección en el registro.`
        : `La sincronización falló tras ${result.retries} reintento(s): ${result.error}. Se avisó a los administradores.`}</p>}
      <h3>Historial de ejecuciones</h3>
      {!data.runs.length ? <p className="muted">Aún no hay ejecuciones.</p> : <div className="table-scroll"><table><thead><tr><th>Inicio (Lima)</th><th>Tipo</th><th>Estado</th><th>Secciones</th><th>Altas</th><th>Bajas</th><th>Sin cuenta</th><th>Reintentos</th><th>Error</th></tr></thead><tbody>
        {data.runs.map(run => <tr key={run.id}><td>{lima(run.startedAt)}</td><td>{run.trigger === 'SCHEDULED' ? 'Nocturna' : 'Manual'}</td><td>{statuses[run.status]}</td>
          <td>{run.sections}</td><td>{run.added}</td><td>{run.removed}</td><td>{run.unknown}</td><td>{run.retries}</td><td>{run.error ?? '—'}</td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}
