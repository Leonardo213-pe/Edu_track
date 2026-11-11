import { useState, type FormEvent } from 'react';
import { api, type Profile } from './api';
export function ProfileView({ profile, token, updated, ended, failed }: { profile: Profile; token: string; updated(profile: Profile): void; ended(): void; failed(error: unknown): void }) {
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setNotice('');
    try { updated(await api<Profile>('me', token, { displayName: data.get('displayName'), version: profile.version }, 'PATCH')); setNotice('Perfil actualizado.'); }
    catch (error) { failed(error); } finally { setBusy(false); }
  }
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    if (data.get('newPassword') !== data.get('confirmation')) { failed(new Error('Las contraseñas nuevas no coinciden.')); return; }
    setBusy(true);
    try { await api('password/change', token, { currentPassword: data.get('currentPassword'), newPassword: data.get('newPassword') }); form.reset(); ended(); }
    catch (error) { failed(error); } finally { setBusy(false); }
  }
  return <div className="admin-grid"><section className="panel"><span className="eyebrow">TU IDENTIDAD</span><h2>Mi perfil</h2><p className="muted">{profile.email}</p>
    <form onSubmit={save}><label htmlFor="profile-name">Nombre completo</label><input id="profile-name" name="displayName" key={profile.displayName} defaultValue={profile.displayName} maxLength={100} required />
      <button className="primary" disabled={busy}>Guardar perfil<span>✓</span></button></form><p className="success" role="status">{notice}</p></section>
    <section className="panel"><span className="eyebrow">SEGURIDAD</span><h2>Cambiar contraseña</h2><p className="muted">Al cambiarla se cerrarán todas tus sesiones. Vuelve a entrar con la nueva contraseña.</p>
      <form onSubmit={change}><label htmlFor="current-password">Contraseña actual</label><input id="current-password" name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required />
        <label htmlFor="new-password">Nueva contraseña</label><input id="new-password" name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        <label htmlFor="confirm-password">Confirma la nueva contraseña</label><input id="confirm-password" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        <button className="primary" disabled={busy}>Cambiar y cerrar sesiones<span>↗</span></button></form></section></div>;
}
