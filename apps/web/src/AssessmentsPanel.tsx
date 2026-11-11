import { useEffect, useState, type FormEvent } from 'react';
import { assessmentStates, evaluationApi, points, questionTypes, type Assessment, type Bank, type MyGrades } from './assessments-api';
import { ExamView } from './ExamView';
import { StudentSubmission, TeacherSubmissions } from './SubmissionsPanel';

type AttemptRow = { id: string; displayName: string; status: string; startedAt: string; finalizedAt: string | null; finalizedBy: string | null; answered: number; questionCount: number; score: number | null };
const attemptStates: Record<string, string> = { IN_PROGRESS: 'En curso', SUBMITTED: 'Finalizado', EXPIRED: 'Cerrado por tiempo' };

type Preview = { poolSize: number; questions: { questionId: string; statement: string; type: keyof typeof questionTypes; pointsCents: number; options: { id: string; text: string; correct: boolean }[] }[] };
const toLocalInput = (iso: string) => { const date = new Date(iso); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

function AssessmentForm({ banks, initial, published, busy, submit }: { banks: Bank[]; initial?: Assessment; published?: boolean; busy: boolean; submit(input: Record<string, unknown>): Promise<void> }) {
  const [type, setType] = useState<'QUIZ' | 'RUBRIC'>(initial?.type ?? 'QUIZ');
  const [criteria, setCriteria] = useState(initial?.criteria.map(item => ({ id: item.id, description: item.description, maxPoints: item.maxPointsCents / 100 })) ?? [{ description: '', maxPoints: 10 }]);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await submit({ title: data.get('title'), instructions: data.get('instructions') ?? '', type, weight: Number(data.get('weight')),
      dueAt: new Date(String(data.get('dueAt'))).toISOString(),
      // Disabled (frozen) inputs are not part of FormData: published assessments resend their frozen definition.
      ...(type === 'QUIZ' ? (published && initial ? { durationMinutes: initial.durationMinutes, questionCount: initial.questionCount, bankId: initial.bankId }
        : { durationMinutes: Number(data.get('durationMinutes')), questionCount: Number(data.get('questionCount')), bankId: data.get('bankId') }) : { criteria }) });
  }
  return <form onSubmit={send} aria-label={initial ? 'Editar evaluación' : 'Nueva evaluación'}>
    <label>Título de la evaluación<input name="title" required maxLength={160} defaultValue={initial?.title} /></label>
    <label>Instrucciones<textarea name="instructions" maxLength={5000} rows={2} defaultValue={initial?.instructions} /></label>
    <div className="form-columns">
      <label>Tipo<select aria-label="Tipo de evaluación" value={type} disabled={published} onChange={event => setType(event.target.value as 'QUIZ' | 'RUBRIC')}>
        <option value="QUIZ">Cuestionario aleatorio</option><option value="RUBRIC">Tarea (entrega de archivo + rúbrica)</option></select></label>
      <label>Peso (%)<input name="weight" type="number" min={0.01} max={100} step={0.01} required defaultValue={initial ? initial.weightBp / 100 : 20} /></label>
    </div>
    <label>Fecha límite<input name="dueAt" type="datetime-local" required defaultValue={initial ? toLocalInput(initial.dueAt) : undefined} /></label>
    {type === 'QUIZ' ? <div className="form-columns">
      <label>Banco de preguntas<select name="bankId" required disabled={published} defaultValue={initial?.bankId ?? ''}>
        <option value="" disabled>Selecciona un banco</option>{banks.map(bank => <option key={bank.id} value={bank.id}>{bank.name}</option>)}</select></label>
      <label>Preguntas por intento<input name="questionCount" type="number" min={1} max={200} required disabled={published} defaultValue={initial?.questionCount ?? 5} /></label>
      <label>Duración (minutos)<input name="durationMinutes" type="number" min={1} max={1440} required disabled={published} defaultValue={initial?.durationMinutes ?? 30} /></label>
    </div> : <fieldset disabled={published}><legend>Criterios de la rúbrica</legend>
      {criteria.map((criterion, index) => <div className="option-row" key={index}>
        <input aria-label={`Criterio ${index + 1}`} required maxLength={500} value={criterion.description} onChange={event => setCriteria(criteria.map((item, position) => position === index ? { ...item, description: event.target.value } : item))} />
        <input aria-label={`Puntaje máximo del criterio ${index + 1}`} type="number" min={0.01} max={100} step={0.01} required value={criterion.maxPoints}
          onChange={event => setCriteria(criteria.map((item, position) => position === index ? { ...item, maxPoints: Number(event.target.value) } : item))} />
        {criteria.length > 1 && <button type="button" className="quiet" onClick={() => setCriteria(criteria.filter((_, position) => position !== index))}>Quitar</button>}
      </div>)}
      {criteria.length < 20 && <button type="button" className="quiet" onClick={() => setCriteria([...criteria, { description: '', maxPoints: 5 }])}>+ Criterio</button>}
    </fieldset>}
    {published && <p className="muted">Evaluación publicada: solo puedes cambiar título, instrucciones, peso y fecha. Cada cambio queda en la auditoría.</p>}
    <button className="primary" disabled={busy} type="submit">{initial ? 'Guardar evaluación' : 'Crear evaluación'}<span>→</span></button>
  </form>;
}

export function AssessmentsPanel({ courseId, courseStatus, token, role, manager, failed }:
  { courseId: string; courseStatus: string; token: string; role: string; manager: boolean; failed(error: unknown): void }) {
  const [items, setItems] = useState<Assessment[] | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [mine, setMine] = useState<MyGrades | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [exam, setExam] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<{ title: string; rows: AttemptRow[] } | null>(null);
  const [delivery, setDelivery] = useState<string | null>(null);
  const student = role === 'STUDENT';
  async function load() {
    try {
      setItems(await evaluationApi<Assessment[]>(`/assessments/courses/${courseId}`, token));
      if (manager) setBanks(await evaluationApi<Bank[]>(`/assessments/courses/${courseId}/banks`, token));
      if (student) setMine(await evaluationApi<MyGrades>(`/grading/courses/${courseId}/me`, token));
    } catch (error) { failed(error); }
  }
  useEffect(() => { void load(); }, [courseId]);
  async function run(work: () => Promise<unknown>, message: string) {
    setBusy(true); setNotice('');
    try { await work(); setEditing(null); setCreating(false); await load(); setNotice(message); } catch (error) { failed(error); } finally { setBusy(false); }
  }
  const totalWeight = (items ?? []).reduce((sum, item) => sum + item.weightBp, 0) / 100;
  const gradeOf = (id: string) => mine?.grades.find(grade => grade.assessmentId === id);
  if (exam) return <ExamView assessmentId={exam} token={token} failed={failed} close={() => { setExam(null); void load(); }} />;
  return <section className="panel"><h3>{student ? 'Evaluaciones y mis notas' : 'Evaluaciones del curso'}</h3>
    {notice && <p className="success" role="status">{notice}</p>}
    {!student && <p className="muted">Peso total asignado: {totalWeight.toLocaleString('es-PE')} % de 100 %. Escala vigesimal 0–20, aprobación con 11.</p>}
    {student && mine && <div className="grade-summary">
      <strong>Promedio ponderado: {mine.average.finalRounded}</strong>
      <span>{mine.average.complete ? (mine.average.approved ? 'Aprobado' : 'Desaprobado') : `Parcial: ${mine.average.gradedWeight} % calificado`}</span>
      <small>Nota acumulada {mine.average.final.toLocaleString('es-PE')} · promedio de lo calificado {mine.average.current?.toLocaleString('es-PE') ?? '—'}</small>
    </div>}
    {manager && !creating && <button className="small-primary" disabled={busy} onClick={() => setCreating(true)}>+ Nueva evaluación</button>}
    {manager && creating && <AssessmentForm banks={banks} busy={busy} submit={input => run(() => evaluationApi(`/assessments/courses/${courseId}`, token, input), 'Evaluación creada en borrador.')} />}
    {!items ? <p role="status">Cargando evaluaciones…</p> : !items.length ? <p className="muted">{student ? 'Aún no hay evaluaciones publicadas.' : 'Aún no hay evaluaciones.'}</p>
      : <div className="table-scroll"><table><thead><tr><th>Evaluación</th><th>Tipo</th><th>Peso</th><th>Fecha límite</th><th>Estado</th>{student ? <th>Mi nota</th> : <th>Acciones</th>}</tr></thead><tbody>
        {items.map(item => <tr key={item.id}>
          <td>{item.title}{item.type === 'QUIZ' && <small> · {item.questionCount} preguntas, {item.durationMinutes} min</small>}</td>
          <td>{item.type === 'QUIZ' ? 'Cuestionario' : 'Tarea'}</td><td>{(item.weightBp / 100).toLocaleString('es-PE')} %</td>
          <td>{new Date(item.dueAt).toLocaleString('es-PE')}</td><td>{assessmentStates[item.status]}</td>
          {student ? <td>{gradeOf(item.id) ? gradeOf(item.id)!.score.toLocaleString('es-PE') : '—'}
            {item.type === 'QUIZ' && <button className="quiet" aria-label={`Rendir ${item.title}`} onClick={() => setExam(item.id)}>{item.status === 'PUBLISHED' ? 'Rendir / continuar' : 'Ver intento'}</button>}
            {item.type === 'RUBRIC' && <button className="quiet" aria-label={`Entrega de ${item.title}`} onClick={() => setDelivery(delivery === item.id ? null : item.id)}>Mi entrega</button>}</td> : <td className="material-actions">
            {manager && item.status !== 'CLOSED' && <button className="quiet" disabled={busy} onClick={() => setEditing(editing === item.id ? null : item.id)}>Editar</button>}
            {manager && item.status === 'DRAFT' && <button className="quiet" disabled={busy || courseStatus !== 'PUBLICADO'} title={courseStatus !== 'PUBLICADO' ? 'Publica primero el curso' : undefined}
              onClick={() => run(() => evaluationApi(`/assessments/${item.id}/publish`, token, { revision: item.revision }), 'Evaluación publicada.')}>Publicar</button>}
            {manager && item.status === 'PUBLISHED' && <button className="quiet" disabled={busy}
              onClick={() => { if (window.confirm('¿Cerrar la evaluación? Seguirá admitiendo calificaciones, pero no cambios.')) void run(() => evaluationApi(`/assessments/${item.id}/close`, token, { revision: item.revision }), 'Evaluación cerrada.'); }}>Cerrar</button>}
            {manager && item.status === 'DRAFT' && <button className="quiet danger" disabled={busy}
              onClick={() => { if (window.confirm('¿Eliminar el borrador?')) void run(() => evaluationApi(`/assessments/${item.id}?revision=${item.revision}`, token, undefined, 'DELETE'), 'Borrador eliminado.'); }}>Eliminar</button>}
            {manager && item.type === 'QUIZ' && item.status !== 'DRAFT' && <button className="quiet" disabled={busy}
              onClick={async () => { try { setAttempts({ title: item.title, rows: await evaluationApi<AttemptRow[]>(`/exams/assessments/${item.id}/attempts`, token) }); } catch (error) { failed(error); } }}>Intentos</button>}
            {(manager || role === 'ADMIN') && item.type === 'RUBRIC' && item.status !== 'DRAFT' && <button className="quiet" disabled={busy} onClick={() => setDelivery(delivery === item.id ? null : item.id)}>Entregas</button>}
            {manager && item.type === 'QUIZ' && <button className="quiet" disabled={busy}
              onClick={async () => { try { setPreview(await evaluationApi<Preview>(`/assessments/${item.id}/preview`, token)); } catch (error) { failed(error); } }}>Vista previa del sorteo</button>}
          </td>}
        </tr>)}</tbody></table></div>}
    {manager && editing && items && (() => { const item = items.find(entry => entry.id === editing)!; return <AssessmentForm key={item.id + item.revision} banks={banks} initial={item} published={item.status !== 'DRAFT'} busy={busy}
      submit={input => run(() => evaluationApi(`/assessments/${item.id}`, token, { ...input, revision: item.revision }, 'PATCH'), 'Evaluación actualizada.')} />; })()}
    {delivery && items && (() => { const item = items.find(entry => entry.id === delivery); if (!item) return null;
      return student ? <StudentSubmission key={item.id} assessment={item} token={token} failed={failed} />
        : <TeacherSubmissions key={item.id} assessment={item} token={token} failed={failed} close={() => setDelivery(null)} />; })()}
    {attempts && <section className="panel" aria-label="Intentos del cuestionario"><div className="section-title"><h4>Intentos: {attempts.title}</h4><button className="quiet" onClick={() => setAttempts(null)}>Cerrar ✕</button></div>
      {!attempts.rows.length ? <p className="muted">Aún no hay intentos.</p> : <div className="table-scroll"><table><thead><tr><th>Estudiante</th><th>Estado</th><th>Inicio</th><th>Fin</th><th>Respondidas</th><th>Nota</th></tr></thead><tbody>
        {attempts.rows.map(row => <tr key={row.id}><td>{row.displayName}</td><td>{attemptStates[row.status] ?? row.status}</td><td>{new Date(row.startedAt).toLocaleString('es-PE')}</td>
          <td>{row.finalizedAt ? new Date(row.finalizedAt).toLocaleString('es-PE') : '—'}</td><td>{row.answered}/{row.questionCount}</td><td>{row.score ?? '—'}</td></tr>)}</tbody></table></div>}</section>}
    {preview && <section className="panel" aria-label="Vista previa del sorteo"><div className="section-title"><h4>Sorteo de ejemplo ({preview.questions.length} de {preview.poolSize})</h4><button className="quiet" onClick={() => setPreview(null)}>Cerrar ✕</button></div>
      <p className="muted">Cada intento del estudiante sorteará su propio conjunto en la fase de exámenes. Esta vista incluye respuestas y solo la ve el docente.</p>
      <ol>{preview.questions.map(question => <li key={question.questionId}><strong>{question.statement}</strong> <small>({points(question.pointsCents)} pts)</small>
        <ul>{question.options.map(option => <li key={option.id}>{option.correct ? '✓ ' : ''}{option.text}</li>)}</ul></li>)}</ol></section>}
  </section>;
}
