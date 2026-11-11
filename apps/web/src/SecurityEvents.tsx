import { useEffect, useState } from 'react';
import { api } from './api';
interface Event { id: string; action: string; actorId: string | null; userId: string | null; occurredAt: string }
const labels: Record<string, string> = { LOGIN_SUCCEEDED: 'Inicio de sesión', LOGIN_FAILED: 'Acceso fallido', TOKEN_REJECTED: 'Token rechazado', LOGOUT: 'Cierre de sesión', ACCESS_DENIED: 'Permiso denegado', USER_CREATED: 'Cuenta creada', USER_UPDATED: 'Cuenta actualizada', PROFILE_UPDATED: 'Perfil actualizado', PASSWORD_CHANGED: 'Contraseña cambiada', RECOVERY_REQUESTED: 'Recuperación solicitada', PASSWORD_RESET: 'Contraseña recuperada', RECOVERY_DELIVERED: 'Correo SMTP aceptado', RECOVERY_DELIVERY_FAILED: 'Fallo de entrega SMTP' };
export function SecurityEvents({ token, failed }: { token: string; failed(error: unknown): void }) {
  const [events, setEvents] = useState<Event[]>([]); const [page, setPage] = useState(0); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; setLoading(true);
    api<Event[]>(`security-events?limit=25&offset=${page * 25}`, token).then(events => { if (active) setEvents(events); })
      .catch(error => { if (active) failed(error); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; };
  }, [token, page]);
  return <section className="panel"><span className="eyebrow">TRAZABILIDAD DE ACCESO</span><h2>Eventos de seguridad</h2><p className="muted">Registro de actividad de identidad. Los eventos no contienen contraseñas ni tokens.</p>
    {loading ? <p role="status">Cargando eventos…</p> : <div className="table-scroll"><table><thead><tr><th>Fecha y hora local</th><th>Evento</th><th>Cuenta afectada (ID)</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td>{new Date(event.occurredAt).toLocaleString('es-PE')}</td><td>{labels[event.action] ?? event.action}</td><td><code>{event.userId ?? 'Sin cuenta identificada'}</code></td></tr>)}</tbody></table></div>}
    <div className="pagination"><button className="quiet" disabled={!page || loading} onClick={() => setPage(page - 1)}>← Anterior</button><span>Página {page + 1}</span><button className="quiet" disabled={events.length < 25 || loading} onClick={() => setPage(page + 1)}>Siguiente →</button></div></section>;
}
