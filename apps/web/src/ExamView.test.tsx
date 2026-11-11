import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ExamView } from './ExamView';

// fetch is an explicit test double; durability and versions are verified against PostgreSQL in the API integration tests.
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const questions = [
  { questionId: 'q1', position: 0, type: 'SINGLE', statement: 'Capital del Perú', pointsCents: 200, options: [{ id: 'a', text: 'Lima' }, { id: 'b', text: 'Cusco' }] },
  { questionId: 'q2', position: 1, type: 'MULTIPLE', statement: 'Números primos', pointsCents: 200, options: [{ id: 'x', text: '2' }, { id: 'y', text: '3' }, { id: 'z', text: '4' }] },
];
const status = { assessment: { id: 'quiz', title: 'Práctica', status: 'PUBLISHED', dueAt: '2026-12-01T12:00:00.000Z', durationMinutes: 30, questionCount: 2 },
  serverTime: '2026-12-01T10:00:00.000Z', canStart: false, attempt: { id: 'att', status: 'IN_PROGRESS' }, score: null };
const view = (answers: unknown[] = []) => ({ id: 'att', assessmentId: 'quiz', status: 'IN_PROGRESS', startedAt: '2026-12-01T10:00:00.000Z', expiresAt: '2026-12-01T10:30:00.000Z',
  finalizedAt: null, finalizedBy: null, serverTime: '2026-12-01T10:05:00.000Z', remainingSeconds: 1500, questions, answers, score: null });
beforeEach(() => localStorage.clear());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test('resumes an attempt: re-sends newer local answers and shows the server-controlled time', async () => {
  localStorage.setItem('edutrack.exam.att', JSON.stringify({ q1: { optionIds: ['a'], version: 4 }, q2: { optionIds: ['z'], version: 1 } }));
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/attempt') ? json(status)
    : init?.method === 'PUT' ? json({ accepted: true, ...JSON.parse(init.body as string) }) : json(view([{ questionId: 'q1', optionIds: ['b'], version: 2 }, { questionId: 'q2', optionIds: ['x'], version: 3 }])));
  vi.stubGlobal('fetch', fetcher);
  render(<ExamView assessmentId="quiz" token="jwt" failed={vi.fn()} close={vi.fn()} />);
  expect(await screen.findByText('Tiempo restante: 25:00')).not.toBeNull();
  await waitFor(() => expect(screen.getByText('Todas las respuestas guardadas')).not.toBeNull());
  const puts = fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(puts.map(([url, init]) => [url, JSON.parse(init!.body as string)])).toEqual([['/api/exams/attempts/att/answers/q1', { optionIds: ['a'], version: 4 }]]);
  expect((screen.getByLabelText('Lima') as HTMLInputElement).checked).toBe(true); expect((screen.getByLabelText('2') as HTMLInputElement).checked).toBe(true);
  expect(localStorage.getItem('edutrack.exam.att')).toBeNull();
});
test('keeps answers locally while offline and re-sends them when the connection returns', async () => {
  let online = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { if (!online) throw new TypeError('Failed to fetch'); return json({ accepted: true, ...JSON.parse(init.body as string) }); }
    return url.endsWith('/attempt') ? json(status) : json(view());
  });
  vi.stubGlobal('fetch', fetcher);
  render(<ExamView assessmentId="quiz" token="jwt" failed={vi.fn()} close={vi.fn()} />); const user = userEvent.setup();
  await user.click(await screen.findByLabelText('Cusco'));
  expect(await screen.findByText('Sin conexión: 1 respuestas pendientes, se reenviarán')).not.toBeNull();
  expect(JSON.parse(localStorage.getItem('edutrack.exam.att')!)).toEqual({ q1: { optionIds: ['b'], version: 1 } });
  await user.click(screen.getByLabelText('3')); expect(JSON.parse(localStorage.getItem('edutrack.exam.att')!).q2).toEqual({ optionIds: ['y'], version: 1 });
  online = true; await act(async () => { window.dispatchEvent(new Event('online')); });
  await waitFor(() => expect(screen.getByText('Todas las respuestas guardadas')).not.toBeNull()); expect(localStorage.getItem('edutrack.exam.att')).toBeNull();
});
test('a closed attempt shows the result and blocks answering', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/attempt') ? json({ ...status, attempt: { id: 'att', status: 'EXPIRED' }, score: 10 })
    : json({ ...view([{ questionId: 'q1', optionIds: ['a'], version: 1 }]), status: 'EXPIRED', finalizedBy: 'TIMEOUT', finalizedAt: '2026-12-01T10:30:00.000Z', remainingSeconds: 0, score: 10 })));
  render(<ExamView assessmentId="quiz" token="jwt" failed={vi.fn()} close={vi.fn()} />);
  expect(await screen.findByText('Intento cerrado por tiempo')).not.toBeNull(); expect(screen.getByText('Tu nota: 10')).not.toBeNull();
  expect(screen.getByLabelText('Cusco').matches(':disabled')).toBe(true); expect(screen.queryByRole('button', { name: /Finalizar/ })).toBeNull();
});
