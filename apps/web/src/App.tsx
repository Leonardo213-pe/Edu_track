import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, roles, type Profile, type Session } from './api';
import { RecoveryView } from './RecoveryView';
import { ProfileView } from './ProfileView';
import { AdminUsers } from './AdminUsers';
import { SecurityEvents } from './SecurityEvents';
import { CoursesWorkspace } from './CoursesWorkspace';
import { AuditView } from './AuditView';
import { RegistryView } from './RegistryView';
import { NotificationsBell } from './NotificationsBell';
function Brand() { return <a className="brand" href="/" aria-label="EduTrack, inicio"><span className="brand-mark">e<span>t</span></span>EduTrack<span className="brand-tag">LMS</span></a>; }
export function App() {
  const [session, setSession] = useState<Session | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(() => new URLSearchParams(location.hash.slice(1)).get('reset'));
  const [recovery, setRecovery] = useState(!!resetToken); const [notice, setNotice] = useState('');
  useEffect(() => {
    function readResetLink() {
      const token = new URLSearchParams(location.hash.slice(1)).get('reset');
      if (token) { setResetToken(token); setRecovery(true); setSession(null); history.replaceState(null, '', location.pathname); }
    }
    readResetLink(); window.addEventListener('hashchange', readResetLink);
    return () => window.removeEventListener('hashchange', readResetLink);
  }, []);
  function ended(message = '') { setSession(null); setError(''); setNotice(message); }
  async function logout() {
    if (!session) return; setBusy(true); setError('');
    try { await api('logout', session.accessToken, {}); ended(); }
    catch (error) { if (error instanceof ApiError && error.status === 401) ended(); else setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice(''); const data = new FormData(event.currentTarget);
    try { setSession(await api<Session>('login', undefined, { email: data.get('email'), password: data.get('password') })); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => { if (!session) return; const timeout = setTimeout(() => ended('Tu sesión venció. Inicia sesión nuevamente.'), session.expiresIn * 1000); return () => clearTimeout(timeout); }, [session]);
  if (session) return <Workspace session={session} logout={logout} busy={busy} error={error} ended={ended} />;
  return <main className="access-shell"><section className="story-panel"><Brand /><div className="story-content"><span className="eyebrow light">TU COMUNIDAD ACADÉMICA</span>
    <h1>El siguiente paso<br />en tu aprendizaje.</h1><p>Un espacio para conectar el conocimiento, las personas y las oportunidades.</p>
    <div className="learning-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="book"><div /><div /><div /></div><span className="spark">✦</span><span className="art-caption">Aprender nos mueve.</span></div>
    </div><footer>EduTrack LMS <span>Plataforma institucional de aprendizaje</span></footer></section>
    <section className="login-panel"><div className="access-note"><span className="status-dot" /> ACCESO INSTITUCIONAL</div>
      {recovery ? <RecoveryView key={resetToken ?? 'request'} token={resetToken} back={() => { setRecovery(false); setResetToken(null); }} /> : <div className="login-card"><span className="eyebrow">BIENVENIDO A EDUTRACK</span><h2>Tu aprendizaje<br />comienza aquí.</h2><p className="muted">Ingresa con tu cuenta institucional para continuar.</p>
        {notice && <p className="notice" role="status">{notice}</p>}<form onSubmit={login}><label htmlFor="email">Correo institucional</label><input id="email" name="email" type="email" autoComplete="username" placeholder="nombre@institucion.edu.pe" maxLength={254} required />
          <label htmlFor="password">Contraseña</label><input id="password" name="password" type="password" autoComplete="current-password" placeholder="Ingresa tu contraseña" maxLength={128} required />
          {error && <p role="alert" className="message">{error}</p>}<button disabled={busy} className="primary" type="submit">{busy ? 'Verificando acceso…' : 'Ingresar a mi espacio'}<span aria-hidden="true">→</span></button></form>
        <button className="text-button" onClick={() => setRecovery(true)}>Olvidé mi contraseña</button><p className="support-note">¿Necesitas una cuenta? Contacta al administrador de tu institución.</p></div>}
      <footer className="login-footer"><span>Conocimiento que conecta.</span><span>© {new Date().getFullYear()} EduTrack</span></footer></section></main>;
}
const introductions = {
  STUDENT: { title: 'Tu espacio de aprendizaje', text: 'Consulta tu perfil y mantén seguro tu acceso institucional.', tag: 'ESTUDIANTE' },
  TEACHER: { title: 'Tu espacio docente', text: 'Gestiona tu identidad para acompañar el aprendizaje de tu comunidad.', tag: 'DOCENTE' },
  INSTRUCTIONAL_DESIGNER: { title: 'Tu espacio de diseño', text: 'Tu cuenta institucional para construir experiencias de aprendizaje.', tag: 'DISEÑO INSTRUCCIONAL' },
  ADMIN: { title: 'Tu centro de administración', text: 'Administra cuentas, asigna roles y revisa los eventos de seguridad.', tag: 'ADMINISTRACIÓN' },
};
function Workspace({ session, logout, busy, error: parentError, ended }: { session: Session; logout(): Promise<void>; busy: boolean; error: string; ended(message?: string): void }) {
  const [profile, setProfile] = useState(session.user); const [view, setView] = useState('home'); const [error, setError] = useState('');
  function failed(error: unknown) { if (error instanceof ApiError && error.status === 401) ended('Tu sesión ya no está vigente. Inicia sesión nuevamente.'); else setError((error as Error).message); }
  async function refreshProfile() { try { setProfile(await api<Profile>('me', session.accessToken)); setError(''); } catch (error) { failed(error); } }
  useEffect(() => { void refreshProfile(); }, [session.accessToken]);
  const intro = introductions[profile.role]; const administrator = profile.role === 'ADMIN';
  function navigate(view: string) { setError(''); setView(view); }
  return <div className="workspace"><header className="topbar"><Brand /><div className="account"><NotificationsBell token={session.accessToken} /><span>{profile.displayName}</span><button disabled={busy} className="quiet" onClick={logout}>Cerrar sesión ↗</button></div></header>
    <main className="workspace-content"><span className="eyebrow">MI ESPACIO / {intro.tag}</span><div className="welcome-row"><div><h1>Hola, {profile.displayName.split(' ')[0]}.</h1><p className="muted">{intro.text}</p></div><span className="role-badge">{roles[profile.role]}</span></div>
      <nav className="workspace-nav" aria-label="Secciones de mi espacio"><button aria-current={view === 'home' ? 'page' : undefined} onClick={() => navigate('home')}>Inicio</button><button aria-current={view === 'profile' ? 'page' : undefined} onClick={() => navigate('profile')}>Mi perfil y seguridad</button>
        <button aria-current={view === 'courses' ? 'page' : undefined} onClick={() => navigate('courses')}>{profile.role === 'STUDENT' ? 'Mis cursos' : profile.role === 'INSTRUCTIONAL_DESIGNER' ? 'Revisión de cursos' : 'Cursos'}</button>
        {administrator && <><button aria-current={view === 'users' ? 'page' : undefined} onClick={() => navigate('users')}>Usuarios y roles</button><button aria-current={view === 'events' ? 'page' : undefined} onClick={() => navigate('events')}>Eventos de seguridad</button><button aria-current={view === 'audit' ? 'page' : undefined} onClick={() => navigate('audit')}>Auditoría</button><button aria-current={view === 'registry' ? 'page' : undefined} onClick={() => navigate('registry')}>Registro académico</button></>}</nav>
      {(error || parentError) && <p role="alert" className="message">{error || parentError}</p>}
      {view === 'home' && <><section className="profile-card"><div className="avatar" aria-hidden="true">{profile.displayName[0]?.toUpperCase()}</div><div><span className="eyebrow">CUENTA INSTITUCIONAL</span><h2>{profile.displayName}</h2><p>{profile.email}</p></div><span className="verified"><span className="status-dot" /> Sesión activa</span></section>
        <section className="panel"><span className="eyebrow">{intro.tag}</span><h2>{intro.title}</h2><p className="muted">{administrator ? 'Las herramientas de identidad están disponibles en Usuarios y roles y Eventos de seguridad.' : 'Puedes actualizar tu nombre y cambiar tu contraseña desde Mi perfil y seguridad.'}</p>
          <p className="muted">Consulta tu espacio académico desde Cursos. Las evaluaciones y calificaciones están en la pestaña Evaluaciones de cada curso.</p><button className="text-button" onClick={() => navigate('courses')}>Abrir espacio académico →</button></section></>}
      {view === 'courses' && <CoursesWorkspace token={session.accessToken} profile={profile} failed={failed} />}
      {view === 'profile' && <ProfileView profile={profile} token={session.accessToken} updated={value => { setProfile(value); setError(''); }} ended={() => ended('Contraseña actualizada. Inicia sesión con tu nueva contraseña.')} failed={failed} />}
      {view === 'users' && administrator && <AdminUsers token={session.accessToken} failed={failed} refreshProfile={refreshProfile} />}
      {view === 'events' && administrator && <SecurityEvents token={session.accessToken} failed={failed} />}
      {view === 'audit' && administrator && <AuditView token={session.accessToken} failed={failed} />}
      {view === 'registry' && administrator && <RegistryView token={session.accessToken} failed={failed} />}
    </main><footer className="workspace-footer">EduTrack LMS<span>Aprendemos. Conectamos. Avanzamos.</span></footer></div>;
}
