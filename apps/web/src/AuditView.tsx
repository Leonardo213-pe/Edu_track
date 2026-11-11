import { useEffect, useState } from 'react';
import { evaluationApi, type AuditEntry } from './assessments-api';

const entities: Record<string, string> = { GRADE: 'Calificación', ASSESSMENT: 'Evaluación publicada' };
const show = (value: unknown) => value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
// Stored hundredths are presented in the units people read (grade 0–20, weight %).
const fields: Record<string, { label: string; scale?: number }> = { scoreCents: { label: 'Nota', scale: 100 }, weightBp: { label: 'Peso %', scale: 100 },
  reason: { label: 'Motivo' }, status: { label: 'Estado' }, title: { label: 'Título' }, dueAt: { label: 'Fecha límite' } };
const render = (field: string, value: unknown) => typeof value === 'number' && fields[field]?.scale ? (value / fields[field]!.scale!).toLocaleString('es-PE') : show(value);

/** CU-14: administrator consults the immutable audit log of grades and published assessments. */
export function AuditView({ token, failed }: { token: string; failed(error: unknown): void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [entity, setEntity] = useState('');
  const [chain, setChain] = useState<{ checked: number; valid: boolean; firstInvalidId: string | null } | null>(null);
  async function load() {
    try { setEntries(await evaluationApi<AuditEntry[]>(`/audit/entries?limit=100${entity ? `&entity=${entity}` : ''}`, token)); } catch (error) { failed(error); }
  }
  useEffect(() => { void load(); }, [entity]);
  return <section className="panel"><span className="eyebrow">CAR-12 · AUDITORÍA INMUTABLE</span><h2>Auditoría de calificaciones y evaluaciones</h2>
    <p className="muted">Registro de solo inserción con hash SHA-256 encadenado. Cada cambio de nota o de una evaluación publicada guarda responsable, fecha, valor anterior y valor nuevo.</p>
    <div className="inline-actions">
      <label>Tipo de registro<select value={entity} onChange={event => setEntity(event.target.value)}><option value="">Todos</option>
        {Object.entries(entities).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button className="quiet" onClick={async () => { try { setChain(await evaluationApi(`/audit/verify`, token)); } catch (error) { failed(error); } }}>Verificar integridad de la cadena</button>
    </div>
    {chain && <p role="status" className={chain.valid ? 'success' : 'message'}>{chain.valid ? `Cadena íntegra: ${chain.checked} registros verificados.` : `Cadena alterada: el registro ${chain.firstInvalidId} no coincide con su hash.`}</p>}
    {!entries ? <p role="status">Cargando auditoría…</p> : !entries.length ? <p className="muted">Sin registros.</p>
      : <div className="table-scroll"><table><thead><tr><th>#</th><th>Fecha (UTC)</th><th>Registro</th><th>Acción</th><th>Responsable</th><th>Cambios (antes → después)</th></tr></thead><tbody>
        {entries.map(entry => <tr key={entry.id}><td>{entry.id}</td><td>{entry.occurredAt.replace('T', ' ').slice(0, 19)}</td><td>{entities[entry.entity] ?? entry.entity}</td>
          <td>{entry.action === 'INSERT' ? 'Registro' : 'Modificación'}</td><td>{entry.actorName}</td>
          <td>{entry.changes.filter(change => !['gradedAt', 'detail', 'publishedAt'].includes(change.field)).map(change =>
            <div key={change.field}><code>{fields[change.field]?.label ?? change.field}</code>: {render(change.field, change.before)} → {render(change.field, change.after)}</div>)}</td></tr>)}</tbody></table></div>}
  </section>;
}
