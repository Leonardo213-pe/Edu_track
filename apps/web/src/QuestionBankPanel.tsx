import { useEffect, useState, type FormEvent } from 'react';
import { evaluationApi, points, questionTypes, type Bank, type Question, type QuestionType } from './assessments-api';

interface Draft { text: string; correct: boolean }
function QuestionForm({ busy, submit }: { busy: boolean; submit(input: { type: QuestionType; statement: string; points: number; options: Draft[] }): Promise<void> }) {
  const [type, setType] = useState<QuestionType>('SINGLE');
  const [options, setOptions] = useState<Draft[]>([{ text: '', correct: true }, { text: '', correct: false }]);
  const [truth, setTruth] = useState(true);
  function mark(index: number, value: boolean) {
    setOptions(options.map((option, position) => ({ ...option, correct: type === 'MULTIPLE' ? (position === index ? value : option.correct) : position === index })));
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const chosen = type === 'TRUE_FALSE' ? [{ text: 'Verdadero', correct: truth }, { text: 'Falso', correct: !truth }] : options.map(option => ({ ...option, text: option.text.trim() }));
    await submit({ type, statement: String(data.get('statement')), points: Number(data.get('points')), options: chosen });
    form.reset(); setOptions([{ text: '', correct: true }, { text: '', correct: false }]);
  }
  return <form onSubmit={send} aria-label="Nueva pregunta">
    <label>Tipo de pregunta<select value={type} onChange={event => setType(event.target.value as QuestionType)}>
      {Object.entries(questionTypes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label>Enunciado<textarea name="statement" required maxLength={5000} rows={3} /></label>
    <label>Puntaje<input name="points" type="number" min={0.01} max={100} step={0.01} defaultValue={1} required /></label>
    {type === 'TRUE_FALSE'
      ? <fieldset><legend>Respuesta correcta</legend>
        <label className="inline-choice"><input type="radio" checked={truth} onChange={() => setTruth(true)} /> Verdadero</label>
        <label className="inline-choice"><input type="radio" checked={!truth} onChange={() => setTruth(false)} /> Falso</label></fieldset>
      : <fieldset><legend>Opciones ({type === 'MULTIPLE' ? 'marca todas las correctas' : 'marca la correcta'})</legend>
        {options.map((option, index) => <div className="option-row" key={index}>
          <input type={type === 'MULTIPLE' ? 'checkbox' : 'radio'} aria-label={`Opción ${index + 1} correcta`} checked={option.correct} onChange={event => mark(index, event.target.checked)} />
          <input aria-label={`Texto de la opción ${index + 1}`} value={option.text} maxLength={1000} required onChange={event => setOptions(options.map((item, position) => position === index ? { ...item, text: event.target.value } : item))} />
          {options.length > 2 && <button type="button" className="quiet" onClick={() => setOptions(options.filter((_, position) => position !== index))}>Quitar</button>}
        </div>)}
        {options.length < 10 && <button type="button" className="quiet" onClick={() => setOptions([...options, { text: '', correct: false }])}>+ Opción</button>}
      </fieldset>}
    <button className="primary" disabled={busy} type="submit">Agregar pregunta<span>→</span></button>
  </form>;
}

export function QuestionBankPanel({ courseId, token, failed }: { courseId: string; token: string; failed(error: unknown): void }) {
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  async function load() { try { setBanks(await evaluationApi<Bank[]>(`/assessments/courses/${courseId}/banks`, token)); } catch (error) { failed(error); } }
  useEffect(() => { void load(); }, [courseId]);
  async function run(work: () => Promise<unknown>, message: string) {
    setBusy(true); setNotice('');
    try { await work(); await load(); setNotice(message); } catch (error) { failed(error); } finally { setBusy(false); }
  }
  function toggle(question: Question) {
    return run(() => evaluationApi(`/assessments/questions/${question.id}`, token, { type: question.type, statement: question.statement, points: question.pointsCents / 100,
      options: question.options, active: !question.active, version: question.version }, 'PATCH'), question.active ? 'Pregunta retirada del banco.' : 'Pregunta reactivada.');
  }
  return <section className="panel"><h3>Banco de preguntas</h3>
    <p className="muted">Las respuestas correctas solo son visibles para el docente. Al publicar una evaluación se congela una copia de las preguntas: editar el banco después no la altera.</p>
    {notice && <p className="success" role="status">{notice}</p>}
    <form aria-label="Nuevo banco" onSubmit={event => { event.preventDefault(); const name = String(new FormData(event.currentTarget).get('name')); void run(() => evaluationApi(`/assessments/courses/${courseId}/banks`, token, { name }), 'Banco creado.'); }}>
      <label>Nombre del banco<input name="name" required maxLength={160} /></label><button className="quiet" disabled={busy} type="submit">Crear banco</button>
    </form>
    {!banks ? <p role="status">Cargando bancos…</p> : !banks.length ? <p className="muted">Aún no hay bancos de preguntas.</p> : banks.map(bank => <article className="course-unit" key={bank.id}>
      <h4>{bank.name} · {bank.questions.filter(question => question.active).length} preguntas activas</h4>
      {bank.questions.map(question => <div className={`question-row${question.active ? '' : ' inactive'}`} key={question.id}>
        <strong>{question.statement}</strong><small>{questionTypes[question.type]} · {points(question.pointsCents)} pts{question.active ? '' : ' · retirada'}</small>
        <ul>{question.options.map(option => <li key={option.id}>{option.correct ? '✓ ' : ''}{option.text}</li>)}</ul>
        <button className="quiet" disabled={busy} onClick={() => void toggle(question)}>{question.active ? 'Retirar' : 'Reactivar'}</button>
      </div>)}
      <details><summary>+ Agregar pregunta a {bank.name}</summary>
        <QuestionForm busy={busy} submit={input => run(() => evaluationApi(`/assessments/banks/${bank.id}/questions`, token, input), 'Pregunta agregada.')} /></details>
    </article>)}
  </section>;
}
