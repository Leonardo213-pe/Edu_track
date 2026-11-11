import { useEffect, useState, type FormEvent } from 'react';
import { evaluationApi, type Gradebook, type GradableView, type GradeView } from './assessments-api';

type Target = { studentId: string; displayName: string; assessment: GradableView; grade?: GradeView };
function GradeForm({ target, busy, submit, cancel }: { target: Target; busy: boolean; submit(input: unknown): Promise<void>; cancel(): void }) {
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await submit({ awards: target.assessment.criteria.map(criterion => ({ criterionId: criterion.id, points: Number(data.get(criterion.id)) })),
      ...(target.grade ? { version: target.grade.version, reason: data.get('reason') } : {}) });
  }
  const previous = (id: string) => (target.grade?.detail.criteria?.find(item => item.criterionId === id)?.pointsCents ?? 0) / 100;
  return <form onSubmit={send} aria-label="Registrar calificación" className="panel">
    <h4>{target.assessment.title} · {target.displayName}</h4>
    {target.assessment.criteria.map(criterion => <label key={criterion.id}>{criterion.description} (máx. {criterion.maxPoints})
      <input name={criterion.id} type="number" min={0} max={criterion.maxPoints} step={0.01} required defaultValue={target.grade ? previous(criterion.id) : undefined} /></label>)}
    {target.grade && <label>Motivo del cambio de nota<textarea name="reason" required maxLength={1000} rows={2} /></label>}
    {target.grade && <p className="muted">Nota actual {target.grade.score.toLocaleString('es-PE')}. El cambio quedará registrado en la auditoría con el valor anterior y el nuevo.</p>}
    <div className="material-actions"><button className="primary" disabled={busy} type="submit">Guardar nota<span>→</span></button><button type="button" className="quiet" onClick={cancel}>Cancelar</button></div>
  </form>;
}

export function GradebookPanel({ courseId, token, failed }: { courseId: string; token: string; failed(error: unknown): void }) {
  const [book, setBook] = useState<Gradebook | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  async function load() { try { setBook(await evaluationApi<Gradebook>(`/grading/courses/${courseId}/gradebook`, token)); } catch (error) { failed(error); } }
  useEffect(() => { void load(); }, [courseId]);
  async function save(input: unknown) {
    if (!target) return; setBusy(true); setNotice('');
    try {
      const saved = await evaluationApi<GradeView>(`/grading/assessments/${target.assessment.id}/students/${target.studentId}`, token, input);
      setTarget(null); await load(); setNotice(`Nota registrada: ${saved.score.toLocaleString('es-PE')}.`);
    } catch (error) { failed(error); } finally { setBusy(false); }
  }
  if (!book) return <section className="panel"><p role="status">Cargando calificaciones…</p></section>;
  return <section className="panel"><h3>Calificaciones</h3>
    <p className="muted">Escala 0–{book.scale.max}, aprobación con {book.scale.passing}. Notas con dos decimales; el promedio final se redondea al entero (0,5 sube). Los cuestionarios se califican automáticamente al rendirse (fase de exámenes).</p>
    {notice && <p className="success" role="status">{notice}</p>}
    {!book.assessments.length ? <p className="muted">Publica evaluaciones para registrar notas.</p> : !book.students.length ? <p className="muted">El curso aún no tiene estudiantes inscritos.</p>
      : <div className="table-scroll"><table><thead><tr><th>Estudiante</th>{book.assessments.map(item => <th key={item.id}>{item.title} ({item.weight} %)</th>)}<th>Promedio</th><th>Estado</th></tr></thead><tbody>
        {book.students.map(student => <tr key={student.studentId}><td>{student.displayName}</td>
          {book.assessments.map(assessment => { const grade = student.grades.find(item => item.assessmentId === assessment.id); return <td key={assessment.id}>
            {grade ? grade.score.toLocaleString('es-PE') : '—'}
            {book.canGrade && assessment.type === 'RUBRIC' && <button className="quiet" aria-label={`${grade ? 'Cambiar' : 'Calificar'} ${assessment.title} de ${student.displayName}`}
              onClick={() => setTarget({ studentId: student.studentId, displayName: student.displayName, assessment, grade })}>{grade ? 'Cambiar' : 'Calificar'}</button>}
          </td>; })}
          <td>{student.average.finalRounded} <small>({student.average.final.toLocaleString('es-PE')})</small></td>
          <td>{student.average.complete ? (student.average.approved ? 'Aprobado' : 'Desaprobado') : `${student.average.gradedWeight} % calificado`}</td>
        </tr>)}</tbody></table></div>}
    {target && <GradeForm key={`${target.studentId}${target.assessment.id}`} target={target} busy={busy} submit={save} cancel={() => setTarget(null)} />}
  </section>;
}
