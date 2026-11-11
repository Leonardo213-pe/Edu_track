import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { App } from './App';
const profile = { id: 'one', displayName: 'Ana Torres', email: 'ana@example.test', role: 'STUDENT', createdAt: '2026-11-10T00:00:00Z' };
afterEach(() => vi.unstubAllGlobals());
test('logs in, shows the real profile and clears the session on logout', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ accessToken: 'token', expiresIn: 900, user: profile }) })
    .mockResolvedValueOnce({ ok: true, json: async () => profile });
  vi.stubGlobal('fetch', fetcher);
  render(<App />); const user = userEvent.setup();
  await user.type(screen.getByLabelText('Correo institucional'), 'ana@example.test');
  await user.type(screen.getByLabelText('Contraseña'), 'example-password');
  await user.click(screen.getByRole('button', { name: /Ingresar/ }));
  expect(await screen.findByText('Hola, Ana.')).not.toBeNull();
  expect(screen.getByText('Estudiante')).not.toBeNull();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1]?.[1].headers.Authorization).toBe('Bearer token');
  expect(localStorage.length).toBe(0);
  await user.click(screen.getByRole('button', { name: /Cerrar sesión/ }));
  expect((screen.getByLabelText('Contraseña') as HTMLInputElement).value).toBe('');
});
test('reports rejected credentials without entering the workspace', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
  render(<App />); const user = userEvent.setup();
  await user.type(screen.getByLabelText('Correo institucional'), 'ana@example.test');
  await user.type(screen.getByLabelText('Contraseña'), 'wrong');
  await user.click(screen.getByRole('button', { name: /Ingresar/ }));
  expect((await screen.findByRole('alert')).textContent).toContain('Credenciales inválidas');
  expect(screen.queryByText('Hola, Ana.')).toBeNull();
});
