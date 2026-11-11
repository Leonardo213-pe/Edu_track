import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from './App';
const profile = { id: 'one', displayName: 'Ana Torres', email: 'ana@example.test', role: 'STUDENT', createdAt: '2026-11-10T00:00:00Z' };
afterEach(() => vi.unstubAllGlobals());
test('logs in, shows the real profile and clears the session on logout', async () => {
  // fetch double answering by URL (the notification bell polls its own endpoint).
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/login') ? { ok: true, json: async () => ({ accessToken: 'token', expiresIn: 900, user: profile }) }
    : url.endsWith('/me') ? { ok: true, json: async () => profile } : url.endsWith('/logout') ? { ok: true, status: 204 }
    : { ok: true, json: async () => ({ unread: 0, notifications: [] }) });
  vi.stubGlobal('fetch', fetcher);
  render(<App />); const user = userEvent.setup();
  await user.type(screen.getByLabelText('Correo institucional'), 'ana@example.test');
  await user.type(screen.getByLabelText('Contraseña'), 'example-password');
  await user.click(screen.getByRole('button', { name: /Ingresar/ }));
  expect(await screen.findByText('Hola, Ana.')).not.toBeNull();
  expect(screen.getByText('Estudiante')).not.toBeNull();
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === '/api/identity/me')).toBe(true));
  expect(fetcher.mock.calls.find(([url]) => url === '/api/identity/me')?.[1]?.headers).toMatchObject({ Authorization: 'Bearer token' });
  expect(localStorage.length).toBe(0);
  await user.click(screen.getByRole('button', { name: /Cerrar sesión/ }));
  expect(((await screen.findByLabelText('Contraseña')) as HTMLInputElement).value).toBe('');
  expect(fetcher.mock.calls.some(([url]) => url === '/api/identity/logout')).toBe(true);
});
test('opens a recovery link in the existing tab after a recovery request', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'Si la cuenta está activa, recibirás instrucciones.' }) }));
  render(<App />); const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
  await user.type(screen.getByLabelText('Correo institucional'), 'ana@example.test'); await user.click(screen.getByRole('button', { name: /Solicitar enlace/ }));
  await screen.findByRole('status');
  window.location.hash = `reset=${'a'.repeat(64)}`;
  expect(await screen.findByLabelText('Nueva contraseña')).not.toBeNull();
  await waitFor(() => expect(window.location.hash).toBe(''));
});
test('reports rejected credentials without entering the workspace', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
  render(<App />); const user = userEvent.setup();
  await user.type(screen.getByLabelText('Correo institucional'), 'ana@example.test');
  await user.type(screen.getByLabelText('Contraseña'), 'wrong');
  await user.click(screen.getByRole('button', { name: /Ingresar/ }));
  expect((await screen.findByRole('alert')).textContent).toContain('Credenciales inválidas');
  expect(screen.queryByText('Hola, Ana.')).toBeNull();
});
