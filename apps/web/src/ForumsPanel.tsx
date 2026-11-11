import { useEffect, useState, type FormEvent } from 'react';
import { evaluationApi } from './assessments-api';

type Access = 'MODERATE' | 'PARTICIPATE' | 'READ';
interface Forum { id: string; title: string; description: string; unitId: string | null; unitTitle: string | null; threadCount: number }
interface ThreadRow { id: string; title: string; authorName: string; pinned: boolean; locked: boolean; messageCount: number; subscribed: boolean; lastActivityAt: string }
interface Message { id: string; authorName: string; createdAt: string; hidden: boolean; body: string | null; hiddenReason: string | null }
interface ThreadView { thread: { id: string; title: string; locked: boolean; pinned: boolean }; access: Access; subscribed: boolean; messages: Message[] }
const api = evaluationApi;
const when = (iso: string) => new Date(iso).toLocaleString('es-PE');

/** CU-05 / CU-09: course and unit forums, threads, replies, subscriptions and moderation. */
export function ForumsPanel({ courseId, token, failed }: { courseId: string; token: string; failed(error: unknown): void }) {
  const [data, setData] = useState<{ access: Access; units: { id: string; title: string }[]; forums: Forum[] } | null>(null);
  const [forum, setForum] = useState<Forum | null>(null);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() { try { setData(await api(`/collaboration/courses/${courseId}/forums`, token)); } catch (error) { failed(error); } }
  useEffect(() => { void load(); }, [courseId]);
  async function openForum(item: Forum) { try { setForum(item); setThread(null); setThreads((await api<{ threads: ThreadRow[] }>(`/collaboration/forums/${item.id}/threads`, token)).threads); } catch (error) { failed(error); } }
  async function openThread(id: string) { try { setThread(await api<ThreadView>(`/collaboration/threads/${id}`, token)); } catch (error) { failed(error); } }
  async function run<T>(work: () => Promise<T>, after?: (value: T) => void) {
    setBusy(true); try { const value = await work(); after?.(value); } catch (error) { failed(error); } finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>, work: (data: FormData) => Promise<void>) {
    event.preventDefault(); const form = event.currentTarget; void work(new FormData(form)).then(() => form.reset());
  }
  if (!data) return <section className="panel"><p role="status">Cargando foros…</p></section>;
  const moderator = data.access === 'MODERATE'; const participant = data.access !== 'READ';

  if (thread && forum) return <section className="panel forum-view">
    <button className="text-button" onClick={() => { setThread(null); void openForum(forum); }}>← {forum.title}</button>
    <div className="section-title"><h3>{thread.thread.pinned ? '📌 ' : ''}{thread.thread.title}{thread.thread.locked ? ' · cerrado' : ''}</h3>
      <div className="inline-actions">
        {participant && <button className="quiet" disabled={busy} onClick={() => run(() => api(`/collaboration/threads/${thread.thread.id}/subscription`, token, thread.subscribed ? undefined : {}, thread.subscribed ? 'DELETE' : undefined), () => openThread(thread.thread.id))}>
          {thread.subscribed ? 'Dejar de seguir' : 'Seguir hilo'}</button>}
        {moderator && <button className="quiet" disabled={busy} onClick={() => run(() => api<ThreadView>(`/collaboration/threads/${thread.thread.id}`, token, { locked: !thread.thread.locked }, 'PATCH'), setThread)}>{thread.thread.locked ? 'Reabrir hilo' : 'Cerrar hilo'}</button>}
        {moderator && <button className="quiet" disabled={busy} onClick={() => run(() => api<ThreadView>(`/collaboration/threads/${thread.thread.id}`, token, { pinned: !thread.thread.pinned }, 'PATCH'), setThread)}>{thread.thread.pinned ? 'Desfijar' : 'Fijar'}</button>}
      </div></div>
    <ol className="forum-messages">{thread.messages.map(message => <li key={message.id} className={message.hidden ? 'hidden-message' : ''}>
      <div className="section-title"><strong>{message.authorName}</strong><small>{when(message.createdAt)}</small></div>
      {message.body === null ? <p className="muted">Mensaje oculto por moderación.</p> : <p className="preserve-text">{message.body}</p>}
      {message.hidden && message.hiddenReason && <p className="muted">Oculto: {message.hiddenReason}</p>}
      {moderator && <button className="quiet" disabled={busy} onClick={() => {
        const reason = message.hidden ? '' : window.prompt('Motivo para ocultar el mensaje'); if (!message.hidden && !reason) return;
        void run(() => api<ThreadView>(`/collaboration/messages/${message.id}`, token, message.hidden ? { hidden: false } : { hidden: true, reason }, 'PATCH'), setThread);
      }}>{message.hidden ? 'Mostrar' : 'Ocultar'}</button>}
    </li>)}</ol>
    {participant && (!thread.thread.locked || moderator) ? <form aria-label="Responder" onSubmit={event => submit(event, data => run(() => api<ThreadView>(`/collaboration/threads/${thread.thread.id}/messages`, token, { body: data.get('body') }), setThread))}>
      <label>Tu respuesta<textarea name="body" required maxLength={10000} rows={3} /></label><button className="primary" disabled={busy} type="submit">Responder<span>→</span></button></form>
      : <p className="muted">{thread.thread.locked ? 'Hilo cerrado por moderación.' : 'Acceso de solo lectura.'}</p>}
  </section>;

  if (forum) return <section className="panel">
    <button className="text-button" onClick={() => { setForum(null); void load(); }}>← Foros del curso</button>
    <h3>{forum.title}</h3>{forum.description && <p className="muted">{forum.description}</p>}
    {!threads.length ? <p className="muted">Aún no hay hilos.</p> : <ul className="forum-list">{threads.map(row => <li key={row.id}>
      <button className="text-button" onClick={() => openThread(row.id)}>{row.pinned ? '📌 ' : ''}{row.title}{row.locked ? ' · cerrado' : ''}</button>
      <small>{row.authorName} · {row.messageCount} mensajes · {when(row.lastActivityAt)}{row.subscribed ? ' · siguiendo' : ''}</small></li>)}</ul>}
    {participant && <form aria-label="Nuevo hilo" onSubmit={event => submit(event, data => run(() => api<{ id: string }>(`/collaboration/forums/${forum.id}/threads`, token, { title: data.get('title'), body: data.get('body') }), created => { void openThread(created.id); }))}>
      <h4>Nuevo hilo</h4><label>Título del hilo<input name="title" required maxLength={160} /></label><label>Mensaje<textarea name="body" required maxLength={10000} rows={3} /></label>
      <button className="primary" disabled={busy} type="submit">Publicar hilo<span>→</span></button></form>}
  </section>;

  return <section className="panel"><h3>Foros del curso</h3>
    {!data.forums.length ? <p className="muted">Aún no hay foros.</p> : <ul className="forum-list">{data.forums.map(item => <li key={item.id}>
      <button className="text-button" onClick={() => openForum(item)}>{item.title}</button><small>{item.unitTitle ? `Unidad: ${item.unitTitle}` : 'Todo el curso'} · {item.threadCount} hilos</small></li>)}</ul>}
    {moderator && <form aria-label="Nuevo foro" onSubmit={event => submit(event, form => run(() => api(`/collaboration/courses/${courseId}/forums`, token, { title: form.get('title'), description: form.get('description') ?? '',
      ...(form.get('unitId') ? { unitId: form.get('unitId') } : {}) }), () => { void load(); }))}>
      <h4>Nuevo foro</h4><label>Título del foro<input name="title" required maxLength={160} /></label><label>Descripción<textarea name="description" maxLength={2000} rows={2} /></label>
      <label>Ámbito<select name="unitId" defaultValue=""><option value="">Todo el curso</option>{data.units.map(unit => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>
      <button className="primary" disabled={busy} type="submit">Crear foro<span>→</span></button></form>}
  </section>;
}
