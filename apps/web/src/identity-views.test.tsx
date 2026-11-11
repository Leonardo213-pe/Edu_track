import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { RecoveryView } from './RecoveryView';
import { ProfileView } from './ProfileView';
import { AdminUsers } from './AdminUsers';
const profile = { id: 'user', email: 'user@example.test', displayName: 'Ana', role: 'STUDENT' as const, active: true, version: 0, permissions: [], createdAt: '2026-11-11' };
afterEach(() => vi.unstubAllGlobals());
test('recovery displays the generic server response', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'Si la cuenta está activa, recibirás instrucciones.' }) }); vi.stubGlobal('fetch', fetcher);
  render(<RecoveryView token={null} back={() => {}} />); const user = userEvent.setup();
  await user.type(screen.getByLabelText('Correo institucional'), profile.email); await user.click(screen.getByRole('button', { name: /Solicitar enlace/ }));
  expect((await screen.findByRole('status')).textContent).toContain('Si la cuenta está activa');
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({ email: profile.email });
});
test('reset rejects mismatching passwords then submits the token and handles expiry', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ code: 'INVALID_RESET' }) }); vi.stubGlobal('fetch', fetcher);
  render(<RecoveryView token={'a'.repeat(64)} back={() => {}} />); const user = userEvent.setup();
  await user.type(screen.getByLabelText('Nueva contraseña'), 'new-password-long'); await user.type(screen.getByLabelText('Confirma la contraseña'), 'other-password-long');
  await user.click(screen.getByRole('button', { name: /Actualizar contraseña/ })); expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('no coinciden'); await user.clear(screen.getByLabelText('Confirma la contraseña'));
  await user.type(screen.getByLabelText('Confirma la contraseña'), 'new-password-long'); await user.click(screen.getByRole('button', { name: /Actualizar contraseña/ }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('venció'));
});
test('profile updates use optimistic concurrency and password changes end the session', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ...profile, displayName: 'Nombre nuevo', version: 1 }) })
    .mockResolvedValueOnce({ ok: true, status: 204 }); vi.stubGlobal('fetch', fetcher);
  const updated = vi.fn(), ended = vi.fn(); render(<ProfileView profile={profile} token="token" updated={updated} ended={ended} failed={vi.fn()} />); const user = userEvent.setup();
  await user.clear(screen.getByLabelText('Nombre completo')); await user.type(screen.getByLabelText('Nombre completo'), 'Nombre nuevo'); await user.click(screen.getByRole('button', { name: /Guardar perfil/ }));
  await waitFor(() => expect(updated).toHaveBeenCalledWith(expect.objectContaining({ version: 1 })));
  expect(fetcher.mock.calls[0]?.[1].method).toBe('PATCH');
  await user.type(screen.getByLabelText('Contraseña actual'), 'old-password-long'); await user.type(screen.getByLabelText('Nueva contraseña'), 'new-password-long');
  await user.type(screen.getByLabelText('Confirma la nueva contraseña'), 'new-password-long'); await user.click(screen.getByRole('button', { name: /Cambiar y cerrar sesiones/ }));
  await waitFor(() => expect(ended).toHaveBeenCalledOnce());
});
test('administration submits actual role/status edits and the version to the API', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [profile] }).mockResolvedValueOnce({ ok: true, json: async () => ({ ...profile, version: 1 }) })
    .mockResolvedValue({ ok: true, json: async () => [{ ...profile, role: 'TEACHER', active: false, version: 1 }] }); vi.stubGlobal('fetch', fetcher);
  render(<AdminUsers token="token" failed={vi.fn()} refreshProfile={vi.fn(async () => {})} />); const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Editar Ana' })); await user.selectOptions(screen.getByLabelText('Rol'), 'TEACHER');
  await user.click(screen.getByLabelText('Cuenta activa')); await user.click(screen.getByRole('button', { name: /Guardar cambios/ }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/identity/users/user', expect.objectContaining({ method: 'PATCH' })));
  expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toMatchObject({ role: 'TEACHER', active: false, version: 0 });
});
