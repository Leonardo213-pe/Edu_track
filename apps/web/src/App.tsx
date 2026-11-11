import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, roles, type Profile, type Role, type Session } from './api';

function Brand() { return <a className="brand" href="/" aria-label="EduTrack, inicio"><span className="brand-mark">e<span>t</span></span>EduTrack<span className="brand-tag">LMS</span></a>; }
function Message({ text }: { text: string }) { return text ? <p role="alert" className="message">{text}</p> : null; }
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function logout() { setSession(null); setError(''); }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    try { setSession(await api<Session>('login', undefined, { email: data.get('email'), password: data.get('password') })); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!session) return;
    const timeout = setTimeout(logout, session.expiresIn * 1000);
    return () => clearTimeout(timeout);
  }, [session]);
  if (session) return <Workspace session={session} logout={logout} />;
  return <main className="access-shell">
    <section className="story-panel"><Brand /><div className="story-content"><span className="eyebrow light">TU COMUNIDAD ACADÉMICA</span>
      <h1>El siguiente paso<br />en tu aprendizaje.</h1><p>Un espacio para conectar el conocimiento, las personas y las oportunidades.</p>
      <div className="learning-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="book"><div /><div /><div /></div><span className="spark">✦</span><span className="art-caption">Aprender nos mueve.</span></div>
    </div><footer>EduTrack LMS <span>Plataforma institucional de aprendizaje</span></footer></section>
    <section className="login-panel"><div className="access-note"><span className="status-dot" /> ACCESO INSTITUCIONAL</div>
      <div className="login-card"><span className="eyebrow">BIENVENIDO A EDUTRACK</span><h2>Tu aprendizaje<br />comienza aquí.</h2><p className="muted">Ingresa con tu cuenta institucional para continuar.</p>
        <form onSubmit={login}><label htmlFor="email">Correo institucional</label><input id="email" name="email" type="email" autoComplete="username" placeholder="nombre@institucion.edu.pe" maxLength={254} required />
          <label htmlFor="password">Contraseña</label><input id="password" name="password" type="password" autoComplete="current-password" placeholder="Ingresa tu contraseña" maxLength={128} required />
          <Message text={error} /><button disabled={busy} className="primary" type="submit">{busy ? 'Verificando acceso…' : 'Ingresar a mi espacio'}<span aria-hidden="true">→</span></button>
        </form><p className="support-note">¿Necesitas una cuenta? Contacta al administrador de tu institución.</p>
      </div><footer className="login-footer"><span>Conocimiento que conecta.</span><span>© {new Date().getFullYear()} EduTrack</span></footer>
    </section>
  </main>;
}

function Workspace({ session, logout }: { session: Session; logout(): void }) {
  const [profile, setProfile] = useState(session.user);
  const [users, setUsers] = useState<Profile[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  function handleError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) logout();
    else setError((error as Error).message);
  }
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    Promise.all([api<Profile>('me', session.accessToken), session.user.role === 'ADMIN'
      ? api<Profile[]>(`users?limit=25&offset=${page * 25}`, session.accessToken) : Promise.resolve([])])
      .then(([me, list]) => { if (active) { setProfile(me); setUsers(list); } })
      .catch(error => { if (active) handleError(error); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.accessToken, page]);
  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    setBusy(true); setError(''); setNotice('');
    try {
      await api<Profile>('users', session.accessToken, Object.fromEntries(data));
      form.reset(); setNotice('Usuario creado correctamente.');
      if (page === 0) setUsers(await api<Profile[]>('users?limit=25&offset=0', session.accessToken));
      else setPage(0);
    } catch (error) { handleError(error); } finally { setBusy(false); }
  }
  return <div className="workspace"><header className="topbar"><Brand /><div className="account"><span>{profile.displayName}</span><button className="quiet" onClick={logout}>Cerrar sesión ↗</button></div></header>
    <main className="workspace-content"><span className="eyebrow">MI ESPACIO / INICIO</span><div className="welcome-row"><div><h1>Hola, {profile.displayName.split(' ')[0]}.</h1><p className="muted">Este es tu espacio en la comunidad EduTrack.</p></div><span className="role-badge">{roles[profile.role]}</span></div>
      <Message text={error} /><section className="profile-card"><div className="avatar" aria-hidden="true">{profile.displayName.slice(0, 1).toUpperCase()}</div><div><span className="eyebrow">CUENTA INSTITUCIONAL</span><h2>{profile.displayName}</h2><p>{profile.email}</p></div><span className="verified"><span className="status-dot" /> Sesión activa</span></section>
      {profile.role === 'ADMIN' ? <section className="admin-grid"><div className="panel"><span className="eyebrow">ADMINISTRACIÓN</span><h2>Comunidad de usuarios</h2><p className="muted">Consulta las cuentas y sus permisos de acceso.</p>
        {loading ? <p role="status">Cargando usuarios…</p> : <div className="table-scroll"><table><thead><tr><th>Usuario</th><th>Rol</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{user.displayName}</strong><span>{user.email}</span></td><td><span className="table-role">{roles[user.role]}</span></td></tr>)}</tbody></table></div>}
        <div className="pagination"><button className="quiet" onClick={() => setPage(page - 1)} disabled={page === 0 || loading}>← Anterior</button><span>Página {page + 1}</span><button className="quiet" onClick={() => setPage(page + 1)} disabled={users.length < 25 || loading}>Siguiente →</button></div></div>
        <div className="panel"><span className="eyebrow">NUEVO ACCESO</span><h2>Agregar usuario</h2><form onSubmit={createUser}>
          <label htmlFor="displayName">Nombre completo</label><input id="displayName" name="displayName" required maxLength={100} autoComplete="off" />
          <label htmlFor="new-email">Correo institucional</label><input id="new-email" name="email" type="email" required maxLength={254} autoComplete="off" />
          <label htmlFor="role">Rol</label><select id="role" name="role" defaultValue="STUDENT">{Object.entries(roles).map(([key, value]) => <option key={key} value={key as Role}>{value}</option>)}</select>
          <label htmlFor="new-password">Contraseña inicial</label><input id="new-password" name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" aria-describedby="password-help" /><small id="password-help">Entre 12 y 128 caracteres.</small>
          <button className="primary" disabled={busy} type="submit">{busy ? 'Creando usuario…' : 'Crear usuario'}<span aria-hidden="true">+</span></button><p className="success" role="status">{notice}</p>
        </form></div></section> : <section className="panel next-step"><span className="eyebrow">PRÓXIMOS PASOS</span><h2>Tu cuenta ya está lista.</h2><p>Los cursos, evaluaciones y materiales se habilitarán en las próximas entregas de la plataforma.</p></section>}
    </main><footer className="workspace-footer">EduTrack LMS <span>Aprendemos. Conectamos. Avanzamos.</span></footer>
  </div>;
}
