import { useEffect, useState } from 'react';
import { evaluationApi } from './assessments-api';

interface Notification { id: string; type: string; title: string; body: string; createdAt: string; readAt: string | null }
const icons: Record<string, string> = { FORUM_REPLY: '💬', FORUM_NEW_THREAD: '🧵', DUE_SOON: '⏰', GRADE: '📝', SYSTEM_ALERT: '⚠️', SUBMISSION: '📎' };

/** In-app inbox (CAR-07): forum replies, new threads, upcoming due dates and grades. Polls every 60 s. */
export function NotificationsBell({ token }: { token: string }) {
  const [inbox, setInbox] = useState<{ unread: number; notifications: Notification[] }>({ unread: 0, notifications: [] });
  const [open, setOpen] = useState(false);
  async function load() { try { setInbox(await evaluationApi(`/collaboration/notifications?limit=30`, token)); } catch { /* the bell never interrupts the page */ } }
  useEffect(() => { void load(); const timer = setInterval(() => { void load(); }, 60_000); return () => clearInterval(timer); }, [token]);
  async function readAll() { try { setInbox(await evaluationApi(`/collaboration/notifications/read`, token, {})); } catch { /* ignore */ } }
  return <div className="notifications">
    <button className="quiet" aria-expanded={open} aria-label={`Notificaciones, ${inbox.unread} sin leer`} onClick={() => { setOpen(!open); if (!open) void load(); }}>
      🔔{inbox.unread > 0 && <span className="badge">{inbox.unread}</span>}</button>
    {open && <div className="notifications-panel" role="region" aria-label="Bandeja de notificaciones">
      <div className="section-title"><strong>Notificaciones</strong>{inbox.unread > 0 && <button className="text-button" onClick={readAll}>Marcar todo como leído</button>}</div>
      {!inbox.notifications.length ? <p className="muted">No tienes notificaciones.</p> : <ul>{inbox.notifications.map(item => <li key={item.id} className={item.readAt ? '' : 'unread'}>
        <span aria-hidden="true">{icons[item.type] ?? '•'}</span><div><strong>{item.title}</strong><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString('es-PE')}</small></div></li>)}</ul>}
    </div>}
  </div>;
}
