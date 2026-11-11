import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';
import { evaluationApi, questionTypes } from './assessments-api';

interface ExamQuestion { questionId: string; position: number; type: keyof typeof questionTypes; statement: string; pointsCents: number; options: { id: string; text: string }[] }
interface AttemptView {
  id: string; assessmentId: string; status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED'; startedAt: string; expiresAt: string; finalizedAt: string | null; finalizedBy: string | null;
  serverTime: string; remainingSeconds: number; questions: ExamQuestion[]; answers: { questionId: string; optionIds: string[]; version: number }[]; score: number | null;
}
interface ExamStatus {
  assessment: { id: string; title: string; status: string; dueAt: string; durationMinutes: number; questionCount: number };
  serverTime: string; canStart: boolean; attempt: { id: string; status: string } | null; score: number | null;
}
type Pending = Record<string, { optionIds: string[]; version: number }>;
const AUTOSAVE_MS = 15_000;
const storageKey = (attemptId: string) => `edutrack.exam.${attemptId}`;
/** Unconfirmed answers survive reloads and lost connections in this browser (EAC-03, flow A1). */
function readPending(attemptId: string): Pending { try { return JSON.parse(localStorage.getItem(storageKey(attemptId)) ?? '{}') as Pending; } catch { return {}; } }
function writePending(attemptId: string, pending: Pending) {
  try { if (Object.keys(pending).length) localStorage.setItem(storageKey(attemptId), JSON.stringify(pending)); else localStorage.removeItem(storageKey(attemptId)); } catch { /* storage unavailable */ }
}
const clock = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;

export function ExamView({ assessmentId, token, failed, close }: { assessmentId: string; token: string; failed(error: unknown): void; close(): void }) {
  const [status, setStatus] = useState<ExamStatus | null>(null);
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [connection, setConnection] = useState<'ok' | 'saving' | 'offline'>('ok');
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const versions = useRef<Record<string, number>>({});
  const pending = useRef<Pending>({});
  const offset = useRef(0);
  const flushing = useRef(false);
  const finalizing = useRef(false);

  const load = useCallback(async () => {
    try {
      const current = await evaluationApi<ExamStatus>(`/exams/assessments/${assessmentId}/attempt`, token); setStatus(current);
      if (current.attempt) await open(current.attempt.id);
    } catch (error) { failed(error); }
  }, [assessmentId, token]);
  useEffect(() => { void load(); }, [load]);

  async function open(attemptId: string) {
    const view = await evaluationApi<AttemptView>(`/exams/attempts/${attemptId}`, token);
    offset.current = new Date(view.serverTime).getTime() - Date.now();
    // Reconnection: the server keeps the last confirmed version; local answers with a newer version are re-sent.
    const local = view.status === 'IN_PROGRESS' ? readPending(view.id) : {};
    const choice: Record<string, string[]> = {}; versions.current = {};
    for (const answer of view.answers) { choice[answer.questionId] = answer.optionIds; versions.current[answer.questionId] = answer.version; }
    for (const [questionId, item] of Object.entries(local)) {
      if (item.version > (versions.current[questionId] ?? 0)) { choice[questionId] = item.optionIds; versions.current[questionId] = item.version; } else delete local[questionId];
    }
    pending.current = local; writePending(view.id, local); setPendingCount(Object.keys(local).length);
    setSelected(choice); setAttempt(view); setRemaining(view.remainingSeconds);
    if (Object.keys(local).length) void flush(view.id);
  }

  async function flush(attemptId = attempt?.id) {
    if (!attemptId || flushing.current) return; flushing.current = true;
    try {
      for (const [questionId, item] of Object.entries(pending.current)) {
        setConnection('saving');
        const ack = await evaluationApi<{ version: number }>(`/exams/attempts/${attemptId}/answers/${questionId}`, token, item, 'PUT');
        // Acknowledged only after the server commit; a newer local change made meanwhile stays pending.
        if (ack.version >= (pending.current[questionId]?.version ?? 0)) delete pending.current[questionId];
        writePending(attemptId, pending.current);
      }
      setConnection('ok');
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) { pending.current = {}; writePending(attemptId, {}); await open(attemptId); }
      else if (error instanceof ApiError && error.status !== 429) failed(error);
      else setConnection('offline');
    } finally { flushing.current = false; setPendingCount(Object.keys(pending.current).length); }
  }

  useEffect(() => {
    if (!attempt || attempt.status !== 'IN_PROGRESS') return;
    const autosave = setInterval(() => { void flush(); }, AUTOSAVE_MS);
    const ticker = setInterval(() => {
      const left = Math.max(0, Math.ceil((new Date(attempt.expiresAt).getTime() - (Date.now() + offset.current)) / 1000)); setRemaining(left);
      if (left === 0 && !finalizing.current) void finish(false);
    }, 500);
    const online = () => { void flush(); };
    window.addEventListener('online', online);
    return () => { clearInterval(autosave); clearInterval(ticker); window.removeEventListener('online', online); };
  }, [attempt?.id, attempt?.status]);

  function choose(question: ExamQuestion, optionId: string, checked: boolean) {
    if (!attempt || attempt.status !== 'IN_PROGRESS' || remaining <= 0) return;
    const current = selected[question.questionId] ?? [];
    const next = question.type === 'MULTIPLE' ? (checked ? [...new Set([...current, optionId])] : current.filter(id => id !== optionId)) : [optionId];
    const version = (versions.current[question.questionId] ?? 0) + 1; versions.current[question.questionId] = version;
    pending.current = { ...pending.current, [question.questionId]: { optionIds: next, version } }; writePending(attempt.id, pending.current);
    setPendingCount(Object.keys(pending.current).length); setSelected({ ...selected, [question.questionId]: next });
    void flush(attempt.id); // save on every change
  }

  async function finish(confirm = true) {
    if (!attempt || finalizing.current) return;
    if (confirm && !window.confirm(pendingCount ? `Hay ${pendingCount} respuestas sin confirmar. Se intentará enviarlas antes de finalizar. ¿Finalizar el examen?` : '¿Finalizar el examen? No podrás cambiar tus respuestas.')) return;
    finalizing.current = true; setBusy(true);
    try {
      await flush(attempt.id);
      const view = await evaluationApi<AttemptView>(`/exams/attempts/${attempt.id}/finalize`, token, {});
      setAttempt(view); writePending(attempt.id, {});
      for (let tries = 0; tries < 10 && view.score === null; tries++) { // automatic grading runs in the background
        await new Promise(resolve => setTimeout(resolve, 1000));
        const latest = await evaluationApi<AttemptView>(`/exams/attempts/${attempt.id}`, token); if (latest.score !== null) { setAttempt(latest); break; }
      }
    } catch (error) { failed(error); } finally { setBusy(false); finalizing.current = false; }
  }

  async function start() {
    if (!status || !window.confirm(`El examen dura ${status.assessment.durationMinutes} minutos desde que lo inicies y el tiempo no se detiene si te desconectas. ¿Comenzar?`)) return;
    setBusy(true);
    try { const view = await evaluationApi<AttemptView>(`/exams/assessments/${assessmentId}/attempt`, token, {}); await open(view.id); } catch (error) { failed(error); } finally { setBusy(false); }
  }

  if (!status) return <section className="panel"><p role="status">Cargando examen…</p></section>;
  const header = <div className="section-title"><div><span className="eyebrow">CUESTIONARIO</span><h3>{status.assessment.title}</h3></div><button className="quiet" onClick={close}>← Volver a evaluaciones</button></div>;
  if (!attempt) return <section className="panel exam-view">{header}
    <p>{status.assessment.questionCount} preguntas sorteadas · {status.assessment.durationMinutes} minutos · cierre {new Date(status.assessment.dueAt).toLocaleString('es-PE')}</p>
    <p className="muted">Tus respuestas se guardan automáticamente al elegirlas y cada 15 segundos. Si pierdes la conexión, se reenviarán al reconectar. El tiempo lo controla el servidor.</p>
    {status.canStart ? <button className="primary" disabled={busy} onClick={start}>Comenzar examen<span>→</span></button> : <p className="message">Este examen ya no admite nuevos intentos.</p>}
  </section>;
  const open_ = attempt.status === 'IN_PROGRESS' && remaining > 0;
  return <section className="panel exam-view">{header}
    {open_ ? <div className={`exam-bar${remaining <= 60 ? ' urgent' : ''}`} role="timer" aria-live="off">
      <strong>Tiempo restante: {clock(remaining)}</strong>
      <span role="status">{connection === 'offline' ? `Sin conexión: ${pendingCount} respuestas pendientes, se reenviarán` : pendingCount || connection === 'saving' ? 'Guardando…' : 'Todas las respuestas guardadas'}</span>
    </div> : <div className="grade-summary" role="status">
      <strong>{attempt.status === 'IN_PROGRESS' ? 'Tiempo agotado: cerrando el intento…' : attempt.finalizedBy === 'TIMEOUT' ? 'Intento cerrado por tiempo' : 'Intento finalizado'}</strong>
      <span>{attempt.score !== null ? `Tu nota: ${attempt.score.toLocaleString('es-PE')}` : attempt.status === 'IN_PROGRESS' ? '' : 'Calificando…'}</span>
    </div>}
    <ol className="exam-questions">{attempt.questions.map(question => <li key={question.questionId}>
      <fieldset disabled={!open_}><legend>{question.statement} <small>({(question.pointsCents / 100).toLocaleString('es-PE')} pts · {questionTypes[question.type]})</small></legend>
        {question.options.map(option => <label className="exam-option" key={option.id}>
          <input type={question.type === 'MULTIPLE' ? 'checkbox' : 'radio'} name={question.questionId} checked={(selected[question.questionId] ?? []).includes(option.id)}
            onChange={event => choose(question, option.id, event.target.checked)} /> {option.text}</label>)}
      </fieldset></li>)}</ol>
    {open_ && <button className="primary" disabled={busy} onClick={() => finish()}>Finalizar examen<span>→</span></button>}
    {!open_ && attempt.status === 'IN_PROGRESS' && <button className="quiet" onClick={() => finish(false)}>Cerrar intento</button>}
  </section>;
}
