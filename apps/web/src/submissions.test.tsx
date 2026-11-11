import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { StudentSubmission, TeacherSubmissions, type MySubmission, type SimilarityReports, type SubmissionList } from './SubmissionsPanel';
import type { Assessment } from './assessments-api';

// fetch is an explicit test double: deadlines, permissions and the SIMULATED provider are verified by API integration tests.
afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const task: Assessment = { id: 'a1', courseId: 'c1', title: 'Ensayo', instructions: '', type: 'RUBRIC', weightBp: 4000, dueAt: '2099-01-01T05:00:00.000Z',
  durationMinutes: null, questionCount: null, criteria: [{ id: 'k1', description: 'Contenido', maxPointsCents: 1500 }, { id: 'k2', description: 'Forma', maxPointsCents: 500 }],
  status: 'PUBLISHED', publishedAt: '' };
const file = { id: 'f1', version: 2, filename: 'ensayo.txt', mimeType: 'text/plain', size: 2048, sha256: 'x', receivedAt: '2026-11-20T15:00:00.000Z' };

test('student submits the assignment file and sees the received version and pending grade', async () => {
  const submitted: MySubmission = { assessmentId: 'a1', title: 'Ensayo', dueAt: task.dueAt, status: 'PUBLISHED', score: null,
    submission: { id: 's1', version: 1, firstSubmittedAt: file.receivedAt, updatedAt: file.receivedAt, current: { ...file, version: 1 }, history: [] } };
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => json(init?.method === 'POST' ? submitted : { ...submitted, submission: null }));
  vi.stubGlobal('fetch', fetcher);
  const failed = vi.fn(); render(<StudentSubmission assessment={task} token="jwt" failed={failed} />);
  expect(await screen.findByText('Sin entrega')).not.toBeNull();
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText(/Archivo/), new File(['texto de la tarea'], 'ensayo.txt', { type: 'text/plain' }));
  await user.click(screen.getByRole('button', { name: 'Entregar' }));
  expect((await screen.findByRole('status')).textContent).toBe('Entrega recibida (versión 1).');
  expect(screen.getByText('Pendiente de calificación')).not.toBeNull();
  const call = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(call[0]).toBe('/api/submissions/assessments/a1'); expect(call[1]!.body).toBeInstanceOf(FormData);
});
test('student cannot submit after the deadline', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({ assessmentId: 'a1', title: 'Ensayo', dueAt: '2020-01-01T00:00:00.000Z', status: 'PUBLISHED', score: 1750, submission: null })));
  render(<StudentSubmission assessment={{ ...task, dueAt: '2020-01-01T00:00:00.000Z' }} token="jwt" failed={vi.fn()} />);
  expect(await screen.findByText('El plazo de entrega terminó.')).not.toBeNull();
  expect(screen.getByText('17.5')).not.toBeNull();
  expect(screen.queryByRole('button', { name: /Entregar/ })).toBeNull();
});
test('teacher sees submissions with the SIMULATED similarity report and grades with the rubric', async () => {
  const list: SubmissionList = { assessmentId: 'a1', title: 'Ensayo', dueAt: task.dueAt, canGrade: true, rows: [
    { studentId: 'ana', displayName: 'Ana', score: null, submission: { id: 's1', version: 2, updatedAt: file.receivedAt, current: file } },
    { studentId: 'beto', displayName: 'Beto', score: null, submission: null }] };
  const reports: SimilarityReports = { provider: 'SIMULADO-NGRAM-v1', simulated: true, reports: [{ fileId: 'f1', studentId: 'ana', status: 'COMPLETED', similarity: 87.5, comparedWith: 1, matches: [{ displayName: 'Carla', similarity: 87.5 }] }] };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => json(init?.method === 'POST' ? {} : url.startsWith('/api/plagiarism') ? reports : list));
  vi.stubGlobal('fetch', fetcher);
  render(<TeacherSubmissions assessment={task} token="jwt" failed={vi.fn()} close={vi.fn()} />);
  const row = await screen.findByRole('row', { name: /Ana/ });
  expect(within(row).getByText('87.5 %')).not.toBeNull(); expect(within(row).getByText(/Carla 87.5 %/)).not.toBeNull();
  expect(screen.getByText('SIMULADO')).not.toBeNull();
  expect(within(screen.getByRole('row', { name: /Beto/ })).getByText('Sin entrega')).not.toBeNull();
  const user = userEvent.setup();
  await user.click(within(row).getByRole('button', { name: 'Calificar' }));
  await user.type(screen.getByLabelText(/Contenido/), '14'); await user.type(screen.getByLabelText(/Forma/), '4.5');
  await user.click(screen.getByRole('button', { name: 'Registrar nota' }));
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(post[0]).toBe('/api/grading/assessments/a1/students/ana');
  expect(JSON.parse(post[1]!.body as string)).toEqual({ awards: [{ criterionId: 'k1', points: 14 }, { criterionId: 'k2', points: 4.5 }] });
  expect((await screen.findByRole('status')).textContent).toBe('Nota registrada y auditada.');
});
