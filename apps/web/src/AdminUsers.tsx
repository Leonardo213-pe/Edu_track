import { useEffect, useState, type FormEvent } from 'react';
import { api, roles, type Profile } from './api';
export function AdminUsers({ token, failed, refreshProfile }: { token: string; failed(error: unknown): void; refreshProfile(): Promise<void> }) {
  const [users, setUsers] = useState<Profile[]>([]); const [page, setPage] = useState(0); const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Profile | null>(null); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true; setLoading(true);
    api<Profile[]>(`users?limit=25&offset=${page * 25}`, token).then(list => { if (active) setUsers(list); })
      .catch(error => { if (active) failed(error); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, page, revision]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setNotice('');
    const body = { displayName: data.get('displayName'), email: data.get('email'), role: data.get('role') };
    try {
      if (selected) await api(`users/${selected.id}`, token, { ...body, active: data.get('active') === 'on', version: selected.version }, 'PATCH');
      else await api('users', token, { ...body, password: data.get('password') });
      setNotice(selected ? 'Usuario actualizado.' : 'Usuario creado.'); setSelected(null); form.reset(); setPage(0); setRevision(value => value + 1); await refreshProfile();
    } catch (error) { failed(error); } finally { setBusy(false); }
  }
  return <div className="admin-grid"><section className="panel"><div className="section-title"><div><span className="eyebrow">ADMINISTRACIÓN</span><h2>Comunidad de usuarios</h2></div>
    <button className="quiet" onClick={() => { setSelected(null); setRevision(value => value + 1); }}>Recargar ↻</button></div><p className="muted">Selecciona una cuenta para editar sus datos, rol y estado.</p>
    {loading ? <p role="status">Cargando usuarios…</p> : <div className="table-scroll"><table><thead><tr><th>Usuario</th><th>Rol y estado</th><th>Acción</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{user.displayName}</strong><span>{user.email}</span></td>
      <td><span className="table-role">{roles[user.role]}</span><span className={user.active ? 'active-label' : 'inactive-label'}>{user.active ? 'Activo' : 'Inactivo'}</span></td><td><button className="quiet" aria-label={`Editar ${user.displayName}`} onClick={() => { setSelected(user); setNotice(''); }}>Editar ↗</button></td></tr>)}</tbody></table></div>}
    <div className="pagination"><button className="quiet" disabled={!page || loading} onClick={() => setPage(page - 1)}>← Anterior</button><span>Página {page + 1}</span><button className="quiet" disabled={users.length < 25 || loading} onClick={() => setPage(page + 1)}>Siguiente →</button></div></section>
    <section className="panel"><span className="eyebrow">{selected ? 'GESTIÓN DE CUENTA' : 'NUEVO ACCESO'}</span><h2>{selected ? 'Editar usuario' : 'Agregar usuario'}</h2>
      <form onSubmit={save} key={selected ? `${selected.id}-${selected.version}` : `new-${revision}`}>
        <label htmlFor="user-name">Nombre completo</label><input id="user-name" name="displayName" defaultValue={selected?.displayName} maxLength={100} required />
        <label htmlFor="user-email">Correo institucional</label><input id="user-email" name="email" type="email" defaultValue={selected?.email} maxLength={254} required />
        <label htmlFor="role">Rol</label><select id="role" name="role" defaultValue={selected?.role ?? 'STUDENT'}>{Object.entries(roles).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
        {selected ? <><label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={selected.active} />Cuenta activa</label><p className="muted">Cambiar correo, rol o estado revoca todas las sesiones de esta cuenta.</p></>
          : <><label htmlFor="initial-password">Contraseña inicial</label><input id="initial-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /><small>Entre 12 y 128 caracteres.</small></>}
        <button className="primary" disabled={busy}>{busy ? 'Guardando…' : selected ? 'Guardar cambios' : 'Crear usuario'}<span>✓</span></button>
        {selected && <button className="text-button" type="button" onClick={() => setSelected(null)}>Cancelar edición</button>}
      </form><p className="success" role="status">{notice}</p></section></div>;
}
