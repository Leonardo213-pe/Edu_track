import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { CoursesWorkspace } from './CoursesWorkspace';
import type { Profile } from './api';
const profile: Profile = { id: 'teacher', role: 'TEACHER', displayName: 'Docente', email: 'doc@example.test', active: true, version: 0, permissions: [], createdAt: '2026-11-11' };
afterEach(() => vi.unstubAllGlobals());
test('creates a real API request bound to the authenticated teacher, not a body role', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [] }).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'course', name: 'Curso', code: 'CS-1', description: 'Curso real', period: '2026', teacherId: profile.id, status: 'BORRADOR', revision: 0, units: [], reviews: [], syllabus: '' }) })
    .mockResolvedValue({ ok: true, json: async () => [] }); vi.stubGlobal('fetch', fetcher);
  render(<CoursesWorkspace token="jwt" profile={profile} failed={vi.fn()} />); const user = userEvent.setup(); await user.click(screen.getByRole('button', { name: /Crear curso/ }));
  await user.type(screen.getByLabelText('Código del curso'), 'CS-1'); await user.type(screen.getByLabelText('Período académico'), '2026'); await user.type(screen.getByLabelText('Nombre del curso'), 'Curso'); await user.type(screen.getByLabelText('Descripción del curso'), 'Curso real');
  await user.click(screen.getByRole('button', { name: /Crear borrador/ })); await screen.findByRole('heading', { name: 'Datos del curso' });
  expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({ code: 'CS-1', period: '2026', name: 'Curso', description: 'Curso real', teacherId: 'teacher' });
  expect(fetcher.mock.calls[1]?.[1].headers.Authorization).toBe('Bearer jwt');
});
test('student listing renders server progress and does not offer editing or creation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'course', code: 'CS-1', name: 'Curso publicado', period: '2026', description: 'Curso', status: 'PUBLICADO', teacherName: 'Docente', unitCount: 1, sessionCount: 1, progress: { percentage: 50, total: 2, completed: 1 } }] }));
  render(<CoursesWorkspace token="jwt" profile={{ ...profile, role: 'STUDENT' }} failed={vi.fn()} />);
  expect(await screen.findByText('Curso publicado')).not.toBeNull(); expect(screen.getByText('50% · 1/2 materiales completados')).not.toBeNull(); expect(screen.queryByRole('button', { name: /Crear curso/ })).toBeNull();
});
