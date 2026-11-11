import { useEffect, useState, type FormEvent } from 'react';
import { evaluationApi, type Assessment } from './assessments-api';
import { ApiError } from './api';

interface FileView { id: string; version: number; filename: string; mimeType: string; size: number; sha256: string; receivedAt: string }
export interface MySubmission {
  assessmentId: string; title: string; dueAt: string; status: string; score: number | null;
  submission: { id: string; version: number; firstSubmittedAt: string; updatedAt: string; current: FileView; history: FileView[] } | null;
}
export interface SubmissionList {
  assessmentId: string; title: string; dueAt: string; canGrade: boolean;
  rows: { studentId: string; displayName: string; score: number | null; submission: { id: string; version: number; updatedAt: string; current: FileView } | null }[];
}
export interface SimilarityReports {
  provider: string; simulated: boolean;
  reports: { fileId: string; studentId: string; status: 'COMPLETED' | 'UNSUPPORTED'; similarity: number | null; comparedWith: number; matches: { displayName: string; similarity: number }[] }[];
}
const lima = (iso: string) => new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima' });
const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const errors: Record<string, string> = { DEADLINE_PASSED: 'La fecha límite ya pasó: no se aceptan más entregas.', FILE_REJECTED: 'Archivo rechazado: solo PDF, DOCX o TXT de hasta 10 MB.',
  NOT_AVAILABLE: 'La tarea está cerrada.', NOT_ENROLLED: 'No estás inscrito en este curso.' };

async function upload(assessmentId: string, token: string, file: File): Promise<MySubmission> {
  const body = new FormData(); body.append('file', file);
  let response: Response;
  try { response = await fetch(`/api/submissions/assessments/${assessmentId}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body }); }
  catch { throw new Error('No se pudo conectar para enviar la entrega.'); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { code?: string };
    throw new ApiError(response.status, errors[result.code ?? ''] ?? (response.status === 413 ? 'El archivo supera 10 MB.' : 'No se pudo registrar la entrega.'));
  }
  return response.json() as Promise<MySubmission>;
}
async function download(fileId: string, filename: string, token: string) {
  const response = await fetch(`/api/submissions/files/${fileId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new ApiError(response.status, 'No se pudo descargar el archivo.');
  const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CU-04 (student): submit or replace the assignment file before the deadline and see its status and grade. */
export function StudentSubmission({ assessment, token, failed }: { assessment: Assessment; token: string; failed(error: unknown): void }) {
  const [data, setData] = useState<MySubmission | null>(null); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  useEffect(() => { evaluationApi<MySubmission>(`/submissions/assessments/${assessment.id}/me`, token).then(setData, failed); }, [assessment.id]);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const file = (form.elements.namedItem('file') as HTMLInputElement | null)?.files?.[0]; if (!file?.size) return;
    setBusy(true); setNotice('');
    try { const result = await upload(assessment.id, token, file); setData(result); setNotice(`Entrega recibida (versión ${result.submission?.version}).`); form.reset(); }
    catch (error) { failed(error); } finally { setBusy(false); }
  }
  const open = assessment.status === 'PUBLISHED' && new Date(assessment.dueAt).getTime() > Date.now();
  return <section className="panel" aria-label={`Entrega de ${assessment.title}`}><h4>Entrega: {assessment.title}</h4>
    <p className="muted">Fecha límite: {lima(assessment.dueAt)} (hora de Lima). Puedes reemplazar el archivo hasta entonces; se conservan todas las versiones.</p>
    {notice && <p className="success" role="status">{notice}</p>}
    {!data ? <p role="status">Cargando entrega…</p> : <>
      <p>{data.submission ? <>Estado: <strong>Entregado</strong> · {data.submission.current.filename} ({size(data.submission.current.size)}) · versión {data.submission.version} · {lima(data.submission.updatedAt)}</>
        : <>Estado: <strong>Sin entrega</strong></>}</p>
      <p>Nota: <strong>{data.score === null ? 'Pendiente de calificación' : (data.score / 100).toLocaleString('es-PE')}</strong></p>
      {open ? <form onSubmit={send} className="inline-actions"><label>Archivo (PDF, DOCX o TXT, máx. 10 MB)<input name="file" type="file" accept=".pdf,.docx,.txt" /></label>
        <button className="primary" disabled={busy} type="submit">{busy ? 'Enviando…' : data.submission ? 'Reemplazar entrega' : 'Entregar'}</button></form>
        : <p className="muted">El plazo de entrega terminó.</p>}
    </>}
  </section>;
}

/** CU-04/CU-15 (teacher): submissions, downloads, similarity report (SIMULATED provider) and rubric grading. */
export function TeacherSubmissions({ assessment, token, failed, close }: { assessment: Assessment; token: string; failed(error: unknown): void; close(): void }) {
  const [list, setList] = useState<SubmissionList | null>(null); const [reports, setReports] = useState<SimilarityReports | null>(null);
  const [grading, setGrading] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  async function load() {
    try {
      const [rows, similarity] = await Promise.all([evaluationApi<SubmissionList>(`/submissions/assessments/${assessment.id}`, token), evaluationApi<SimilarityReports>(`/plagiarism/assessments/${assessment.id}`, token)]);
      setList(rows); setReports(similarity);
    } catch (error) { failed(error); }
  }
  useEffect(() => { void load(); }, [assessment.id]);
  const reportOf = (fileId: string) => reports?.reports.find(report => report.fileId === fileId);
  async function grade(event: FormEvent<HTMLFormElement>, studentId: string) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true);
    try {
      await evaluationApi(`/grading/assessments/${assessment.id}/students/${studentId}`, token, { awards: assessment.criteria.map(criterion => ({ criterionId: criterion.id, points: Number(data.get(criterion.id)) })) });
      setGrading(null); setNotice('Nota registrada y auditada.'); await load();
    } catch (error) { failed(error); } finally { setBusy(false); }
  }
  return <section className="panel" aria-label={`Entregas de ${assessment.title}`}><div className="section-title"><h4>Entregas: {assessment.title}</h4><span className="inline-actions"><button className="quiet" onClick={() => void load()}>Actualizar</button><button className="quiet" onClick={close}>Cerrar ✕</button></span></div>
    {reports?.simulated && <p className="muted"><span className="role-badge">SIMULADO</span> Similitud calculada por un proveedor de plagio simulado ({reports.provider}): compara por n-gramas con las entregas de otros estudiantes del curso. No es el servicio institucional.</p>}
    {notice && <p className="success" role="status">{notice}</p>}
    {!list ? <p role="status">Cargando entregas…</p> : <div className="table-scroll"><table><thead><tr><th>Estudiante</th><th>Entrega</th><th>Similitud</th><th>Nota</th><th>Acciones</th></tr></thead><tbody>
      {list.rows.map(row => { const report = row.submission ? reportOf(row.submission.current.id) : undefined; return <tr key={row.studentId}>
        <td>{row.displayName}</td>
        <td>{row.submission ? <>{row.submission.current.filename} · v{row.submission.version}<br /><small>{lima(row.submission.updatedAt)}</small></> : 'Sin entrega'}</td>
        <td>{!row.submission ? '—' : !report ? 'Analizando…' : report.status === 'UNSUPPORTED' ? 'Sin texto analizable'
          : <><strong>{report.similarity!.toLocaleString('es-PE')} %</strong>{report.matches.length > 0 && <small> · {report.matches.map(match => `${match.displayName} ${match.similarity.toLocaleString('es-PE')} %`).join(', ')}</small>}</>}</td>
        <td>{row.score === null ? '—' : (row.score / 100).toLocaleString('es-PE')}</td>
        <td className="material-actions">{row.submission && <button className="quiet" onClick={() => download(row.submission!.current.id, row.submission!.current.filename, token).catch(failed)}>Descargar</button>}
          {list.canGrade && row.submission && row.score === null && <button className="quiet" onClick={() => setGrading(grading === row.studentId ? null : row.studentId)}>Calificar</button>}
          {list.canGrade && row.score !== null && <small>Cambios con motivo en Calificaciones</small>}</td>
      </tr>; })}</tbody></table></div>}
    {grading && <form aria-label="Calificar con rúbrica" onSubmit={event => grade(event, grading)}>
      {assessment.criteria.map(criterion => <label key={criterion.id}>{criterion.description} (máx. {criterion.maxPointsCents / 100})
        <input name={criterion.id} type="number" min={0} max={criterion.maxPointsCents / 100} step={0.01} required /></label>)}
      <button className="primary" disabled={busy} type="submit">Registrar nota</button></form>}
  </section>;
}
