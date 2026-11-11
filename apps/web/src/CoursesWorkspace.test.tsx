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
const course = { id: '11111111-1111-4111-8111-111111111111', name: 'Curso', code: 'CS-1', description: 'Curso real', period: '2026', teacherId: 'teacher', teacherName: 'Docente', status: 'BORRADOR', revision: 3,
  durationMinutes: 90, removable: true, syllabus: 'Sílabo', reviews: [],
  units: [{ id: 'unit-1', title: 'Unidad 1', position: 0, sessions: [{ id: 'session-1', title: 'Sesión 1', description: '', durationMinutes: 90, position: 0, materials: [] }] }] };
const summary = { ...course, unitCount: 1, sessionCount: 1 };
function json(body: unknown) { return { ok: true, json: async () => body }; }
test('administrator synchronizes the official enrollment list of a course', async () => {
  const roster = { courseId: course.id, students: [], runs: [] };
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/teachers') ? json([]) : url === '/api/courses' ? json([summary]) : url.startsWith('/api/enrollments') ? json(url.endsWith('/roster')
    ? { ...roster, added: 2, removed: 0, total: 2, students: [{ id: 's1', displayName: 'Ana', email: 'ana@example.test' }, { id: 's2', displayName: 'Beto', email: 'beto@example.test' }] } : roster) : json(course));
  vi.stubGlobal('fetch', fetcher);
  render(<CoursesWorkspace token="jwt" profile={{ ...profile, id: 'admin', role: 'ADMIN' }} failed={vi.fn()} />); const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Abrir curso/ })); expect(screen.getByText(/Duración total: 1 h 30 min/)).not.toBeNull();
  await user.click(screen.getByRole('button', { name: 'Inscritos' }));
  await user.type(await screen.findByLabelText('Correos de estudiantes inscritos'), 'ana@example.test\nbeto@example.test');
  await user.click(screen.getByRole('button', { name: /Sincronizar lista oficial/ }));
  expect(await screen.findByText('Lista sincronizada: 2 altas, 0 bajas, 2 inscritos.')).not.toBeNull(); expect(screen.getByText('Beto')).not.toBeNull();
  const call = fetcher.mock.calls.find(([url]) => url === `/api/enrollments/courses/${course.id}/roster`)!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ emails: ['ana@example.test', 'beto@example.test'] });
});
test('teacher removes structure of a never-published draft with the current revision and a confirmation', async () => {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => url === '/api/courses' ? json([summary]) : json(course)); vi.stubGlobal('fetch', fetcher);
  const confirm = vi.fn(() => true); vi.stubGlobal('confirm', confirm);
  render(<CoursesWorkspace token="jwt" profile={profile} failed={vi.fn()} />); const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Abrir curso/ })); await user.click(screen.getByRole('button', { name: 'Eliminar sesión' }));
  expect(confirm).toHaveBeenCalled();
  const call = fetcher.mock.calls.find(([, init]) => init?.method === "DELETE")!;
  expect(call[0]).toBe(`/api/courses/${course.id}/sessions/session-1?revision=3`);
});
test('published-before drafts and students do not offer removal', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/courses' ? json([summary]) : json({ ...course, removable: false })));
  render(<CoursesWorkspace token="jwt" profile={profile} failed={vi.fn()} />); const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Abrir curso/ }));
  expect(screen.queryByRole('button', { name: /Eliminar/ })).toBeNull(); expect(screen.getByText(/ya fue publicado/)).not.toBeNull();
});
