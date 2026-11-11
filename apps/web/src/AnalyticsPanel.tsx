import { useEffect, useState, type FormEvent } from 'react';
import { evaluationApi } from './assessments-api';

interface Row { studentId: string; displayName: string; progress: number; average: number | null; missed: number; inactiveDays: number | null; totalMinutes: number; lastWeekMinutes: number; level: 'BAJO' | 'MEDIO' | 'ALTO'; reasons: string[] }
interface Dashboard { generatedAt: string; rules: { minProgress: number; minAverage: number; maxInactiveDays: number; maxMissed: number; custom: boolean }; summary: { students: number; ALTO: number; MEDIO: number; BAJO: number }; students: Row[] }
const hours = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;

/** CU-11 / CAR-08: progress, connection time and explainable risk with configurable rules (no ML). */
export function AnalyticsPanel({ courseId, token, canEdit, failed }: { courseId: string; token: string; canEdit: boolean; failed(error: unknown): void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  async function load() { try { setData(await evaluationApi<Dashboard>(`/analytics/courses/${courseId}`, token)); } catch (error) { failed(error); } }
  useEffect(() => { void load(); }, [courseId]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setNotice('');
    try {
      setData(await evaluationApi<Dashboard>(`/analytics/courses/${courseId}/rules`, token, { minProgress: Number(form.get('minProgress')), minAverage: Number(form.get('minAverage')),
        maxInactiveDays: Number(form.get('maxInactiveDays')), maxMissed: Number(form.get('maxMissed')) }, 'PUT'));
      setNotice('Reglas de riesgo actualizadas.');
    } catch (error) { failed(error); } finally { setBusy(false); }
  }
  if (!data) return <section className="panel"><p role="status">Calculando seguimiento…</p></section>;
  return <section className="panel"><h3>Seguimiento y riesgo académico</h3>
    <p className="muted">Calculado el {new Date(data.generatedAt).toLocaleString('es-PE')} a partir del avance en materiales, notas, evaluaciones vencidas y tiempo de conexión. Reglas configurables, sin modelos predictivos.</p>
    {notice && <p className="success" role="status">{notice}</p>}
    <div className="risk-summary"><span className="risk ALTO">Alto: {data.summary.ALTO}</span><span className="risk MEDIO">Medio: {data.summary.MEDIO}</span><span className="risk BAJO">Bajo: {data.summary.BAJO}</span><span>{data.summary.students} inscritos</span></div>
    {!data.students.length ? <p className="muted">El curso aún no tiene estudiantes inscritos.</p> : <div className="table-scroll"><table><thead><tr><th>Estudiante</th><th>Riesgo</th><th>Avance</th><th>Promedio</th><th>Vencidas</th><th>Conexión (7 días / total)</th><th>Motivos</th></tr></thead><tbody>
      {data.students.map(row => <tr key={row.studentId}><td>{row.displayName}</td><td><span className={`risk ${row.level}`}>{row.level}</span></td><td>{row.progress}%</td>
        <td>{row.average === null ? '—' : row.average.toLocaleString('es-PE')}</td><td>{row.missed}</td>
        <td>{hours(row.lastWeekMinutes)} / {hours(row.totalMinutes)}{row.inactiveDays !== null ? ` · hace ${row.inactiveDays} d` : ' · nunca'}</td>
        <td>{row.reasons.length ? <ul>{row.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : 'Sin alertas'}</td></tr>)}</tbody></table></div>}
    <details open={canEdit}><summary>Reglas de riesgo {data.rules.custom ? '(personalizadas)' : '(predeterminadas)'}</summary>
      <form aria-label="Reglas de riesgo" onSubmit={save}><fieldset disabled={!canEdit || busy}><div className="form-columns">
        <label>Avance mínimo (%)<input name="minProgress" type="number" min={0} max={100} step={1} defaultValue={data.rules.minProgress} required /></label>
        <label>Promedio mínimo (0–20)<input name="minAverage" type="number" min={0} max={20} step={0.01} defaultValue={data.rules.minAverage} required /></label>
        <label>Días máximos sin actividad<input name="maxInactiveDays" type="number" min={1} max={365} step={1} defaultValue={data.rules.maxInactiveDays} required /></label>
        <label>Evaluaciones vencidas toleradas<input name="maxMissed" type="number" min={1} max={100} step={1} defaultValue={data.rules.maxMissed} required /></label>
      </div><p className="muted">Cada regla incumplida suma un motivo: ninguno = bajo, uno = medio, dos o más = alto.</p>
      {canEdit && <button className="primary" type="submit">Guardar reglas<span>→</span></button>}</fieldset></form></details>
  </section>;
}
