import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { AssessmentsPanel } from './AssessmentsPanel';
import { QuestionBankPanel } from './QuestionBankPanel';
import { GradebookPanel } from './GradebookPanel';
import { AuditView } from './AuditView';

// fetch is an explicit test double: backend permissions are verified by the API integration tests.
afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const average = { current: 16, final: 9.6, finalRounded: 10, approved: false, gradedWeight: 60, totalWeight: 100, complete: false };
const essay = { id: 'essay', title: 'Ensayo', type: 'RUBRIC', weight: 60, status: 'PUBLISHED', dueAt: '2026-12-01T15:00:00.000Z', criteria: [{ id: 'c1', description: 'Contenido', maxPoints: 15 }, { id: 'c2', description: 'Forma', maxPoints: 5 }] };

test('student sees published assessments, own grade and weighted average without management actions', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/grading/') ? json({ courseId: 'c', scale: { max: 20, passing: 11 }, assessments: [essay], grades: [{ assessmentId: 'essay', score: 16, origin: 'RUBRIC', detail: {}, gradedAt: '', version: 0 }], average })
    : json([{ id: 'essay', courseId: 'c', title: 'Ensayo', instructions: '', type: 'RUBRIC', weightBp: 6000, dueAt: essay.dueAt, durationMinutes: null, questionCount: null, criteria: [], status: 'PUBLISHED', publishedAt: '' }])));
  render(<AssessmentsPanel courseId="c" courseStatus="PUBLICADO" token="jwt" role="STUDENT" manager={false} failed={vi.fn()} />);
  expect(await screen.findByText('Promedio ponderado: 10')).not.toBeNull(); expect(screen.getByText('Parcial: 60 % calificado')).not.toBeNull();
  const row = screen.getByRole('row', { name: /Ensayo/ }); expect(within(row).getByText('16')).not.toBeNull();
  expect(screen.queryByRole('button', { name: /Publicar|Nueva evaluación|Vista previa/ })).toBeNull();
});
test('teacher adds a true/false question with the selected correct answer', async () => {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => json(url.endsWith('/banks') ? [{ id: 'b1', courseId: 'c', name: 'Unidad 1', questions: [] }] : {}));
  vi.stubGlobal('fetch', fetcher); render(<QuestionBankPanel courseId="c" token="jwt" failed={vi.fn()} />); const user = userEvent.setup();
  await user.click(await screen.findByText('+ Agregar pregunta a Unidad 1'));
  await user.selectOptions(screen.getByLabelText('Tipo de pregunta'), 'TRUE_FALSE'); await user.type(screen.getByLabelText('Enunciado'), 'El sol es una estrella');
  await user.click(screen.getByLabelText('Falso')); await user.click(screen.getByRole('button', { name: /Agregar pregunta/ }));
  const call = fetcher.mock.calls.find(([url]) => url === '/api/assessments/banks/b1/questions')!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ type: 'TRUE_FALSE', statement: 'El sol es una estrella', points: 1, options: [{ text: 'Verdadero', correct: false }, { text: 'Falso', correct: true }] });
});
test('changing an existing grade sends the current version and a mandatory reason', async () => {
  const book = { courseId: 'c', scale: { max: 20, passing: 11 }, canGrade: true, assessments: [essay],
    students: [{ studentId: 's1', displayName: 'Ana', grades: [{ assessmentId: 'essay', score: 16, origin: 'RUBRIC', detail: { criteria: [{ criterionId: 'c1', pointsCents: 1200 }, { criterionId: 'c2', pointsCents: 400 }] }, reason: 'Calificación inicial', gradedAt: '', version: 2 }], average }] };
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => json(url.includes('/gradebook') ? book : { score: 11 })); vi.stubGlobal('fetch', fetcher);
  render(<GradebookPanel courseId="c" token="jwt" failed={vi.fn()} />); const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Cambiar Ensayo de Ana' }));
  expect((screen.getByLabelText('Contenido (máx. 15)') as HTMLInputElement).value).toBe('12');
  await user.clear(screen.getByLabelText('Contenido (máx. 15)')); await user.type(screen.getByLabelText('Contenido (máx. 15)'), '7');
  await user.type(screen.getByLabelText('Motivo del cambio de nota'), 'Reclamo atendido'); await user.click(screen.getByRole('button', { name: /Guardar nota/ }));
  const call = fetcher.mock.calls.find(([url]) => url === '/api/grading/assessments/essay/students/s1')!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ awards: [{ criterionId: 'c1', points: 7 }, { criterionId: 'c2', points: 4 }], version: 2, reason: 'Reclamo atendido' });
  expect(await screen.findByText('Nota registrada: 11.')).not.toBeNull();
});
test('administrator reads before/after audit values and verifies the hash chain', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/verify') ? json({ checked: 2, valid: true, firstInvalidId: null })
    : json([{ id: '2', entity: 'GRADE', entityId: 'g', action: 'UPDATE', actorId: 't', actorName: 'Docente QA', occurredAt: '2026-11-13T10:00:00.000Z', hash: 'h',
      changes: [{ field: 'scoreCents', before: 1600, after: 1100 }, { field: 'gradedAt', before: 'a', after: 'b' }] }])));
  render(<AuditView token="jwt" failed={vi.fn()} />); const user = userEvent.setup();
  expect(await screen.findByText('Docente QA')).not.toBeNull(); expect(screen.getByText(/16 → 11/)).not.toBeNull(); expect(screen.queryByText(/gradedAt/)).toBeNull();
  await user.click(screen.getByRole('button', { name: /Verificar integridad/ })); expect(await screen.findByText('Cadena íntegra: 2 registros verificados.')).not.toBeNull();
});
