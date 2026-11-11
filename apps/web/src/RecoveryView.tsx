import { useState, type FormEvent } from 'react';
import { api } from './api';
export function RecoveryView({ token, back }: { token: string | null; back(): void }) {
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    if (token && data.get('password') !== data.get('confirmation')) { setError('Las contraseñas no coinciden.'); return; }
    setBusy(true); setError('');
    try {
      if (token) {
        await api('password/reset', undefined, { token, password: data.get('password') });
        setNotice('Contraseña actualizada. Tus sesiones anteriores se cerraron. Ya puedes iniciar sesión.');
      } else {
        const result = await api<{ message: string }>('password/recovery', undefined, { email: data.get('email') }); setNotice(result.message);
      }
      form.reset();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <div className="login-card"><span className="eyebrow">RECUPERA TU ESPACIO</span><h2>{token ? 'Una nueva contraseña.' : 'Volvamos a conectar.'}</h2>
    <p className="muted">{token ? 'Elige una contraseña de 12 a 128 caracteres.' : 'Escribe el correo de tu cuenta. Te enviaremos un enlace válido por 15 minutos.'}</p>
    {notice ? <div className="notice" role="status">{notice}</div> : <form onSubmit={submit}>
      {token ? <><label htmlFor="reset-password">Nueva contraseña</label><input id="reset-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        <label htmlFor="confirmation">Confirma la contraseña</label><input id="confirmation" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></>
        : <><label htmlFor="recovery-email">Correo institucional</label><input id="recovery-email" name="email" type="email" autoComplete="email" maxLength={254} required /></>}
      {error && <p className="message" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy ? 'Procesando…' : token ? 'Actualizar contraseña' : 'Solicitar enlace'}<span>→</span></button>
    </form>}<button className="text-button" onClick={back}>← Volver al inicio de sesión</button>
  </div>;
}
