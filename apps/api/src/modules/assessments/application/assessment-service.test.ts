import { beforeEach, describe, expect, it } from 'vitest';
import { AssessmentService } from './assessment-service';
import { Assessment, type SnapshotQuestion } from '../domain/assessment';
import { AssessmentError, Question } from '../domain/question';
import type { AssessmentActor, AssessmentRepository, Bank, CourseSummary } from './ports';

const actors: Record<string, AssessmentActor> = {
  teacher: { id: 'teacher', role: 'TEACHER' }, other: { id: 'other', role: 'TEACHER' }, admin: { id: 'admin', role: 'ADMIN' },
  designer: { id: 'designer', role: 'INSTRUCTIONAL_DESIGNER' }, student: { id: 'student', role: 'STUDENT' },
};
let course: CourseSummary, banks: Map<string, Bank>, questions: Map<string, Question>, assessments: Map<string, Assessment>, snapshots: Map<string, SnapshotQuestion[]>;
let enrolled: boolean, service: AssessmentService, audits: string[];
beforeEach(() => {
  course = { id: 'course', code: 'CS-1', name: 'Curso', teacherId: 'teacher', status: 'PUBLICADO' };
  banks = new Map(); questions = new Map(); assessments = new Map(); snapshots = new Map(); enrolled = true; audits = [];
  // Explicit in-memory double of the persistence port; integration tests use PostgreSQL and the audit trigger.
  const repo: AssessmentRepository = {
    banks: async courseId => [...banks.values()].filter(bank => bank.courseId === courseId).map(bank => ({ ...bank, questions: [...questions.values()].filter(q => q.data.bankId === bank.id) })),
    findBank: async id => banks.get(id) ?? null, createBank: async bank => { banks.set(bank.id, bank); },
    findQuestion: async id => questions.get(id) ?? null, bankQuestions: async bankId => [...questions.values()].filter(q => q.data.bankId === bankId),
    saveQuestion: async (question, expected) => { if (expected !== null && questions.get(question.data.id)?.data.version !== expected) throw new AssessmentError('CONFLICT'); questions.set(question.data.id, question); },
    list: async courseId => [...assessments.values()].filter(item => item.data.courseId === courseId), find: async id => assessments.get(id) ?? null,
    create: async (assessment, decide) => { decide([...assessments.values()]); assessments.set(assessment.data.id, assessment); },
    mutate: async (id, revision, actorId, work) => {
      const target = assessments.get(id); if (!target) throw new AssessmentError('NOT_FOUND'); if (target.data.revision !== revision) throw new AssessmentError('CONFLICT');
      const copy = Assessment.restore(target.snapshot()); const snapshot = await work(copy, [...assessments.values()].filter(item => item.data.id !== id));
      copy.advanceRevision(); if (copy.data.status !== 'DRAFT') audits.push(`${actorId}:${copy.data.status}`);
      assessments.set(id, copy); if (snapshot?.length) snapshots.set(id, snapshot); return copy;
    },
    remove: async (id, revision) => { if (assessments.get(id)?.data.revision !== revision) throw new AssessmentError('CONFLICT'); assessments.delete(id); },
    snapshot: async id => snapshots.get(id) ?? [],
  };
  let id = 0;
  service = new AssessmentService(repo, { describe: async id => id === course.id ? course : null }, { find: async id => actors[id] ?? null },
    { has: async () => enrolled }, { id: () => `id-${++id}`, now: () => '2026-11-13T00:00:00.000Z', random: () => 0 });
});
const tf = (statement: string) => ({ type: 'TRUE_FALSE' as const, statement, points: 1, options: [{ text: 'Verdadero', correct: true }, { text: 'Falso', correct: false }] });
async function bankWithQuestions(count = 2) {
  const [bank] = await service.createBank('teacher', 'course', 'Unidad 1');
  for (let index = 0; index < count; index++) await service.addQuestion('teacher', bank!.id, tf(`Pregunta ${index}`));
  return bank!;
}
const quizInput = (bankId: string) => ({ title: 'Práctica', instructions: '', type: 'QUIZ' as const, weight: 50, dueAt: '2026-12-01T00:00:00Z', durationMinutes: 30, questionCount: 2, bankId });

describe('assessment use cases', () => {
  it('lets only the responsible teacher or an admin manage banks and questions', async () => {
    const bank = await bankWithQuestions(1); expect((await service.banks('admin', 'course'))[0]!.questions).toHaveLength(1);
    for (const actor of ['other', 'designer', 'student', 'missing']) await expect(service.banks(actor, 'course')).rejects.toThrow(/FORBIDDEN/);
    await expect(service.addQuestion('other', bank.id, tf('x'))).rejects.toThrow('FORBIDDEN');
    await expect(service.addQuestion('teacher', 'missing', tf('x'))).rejects.toThrow('NOT_FOUND');
    await expect(service.banks('teacher', 'missing')).rejects.toThrow('NOT_FOUND');
    const [question] = (await service.banks('teacher', 'course'))[0]!.questions;
    expect((await service.editQuestion('teacher', question!.id, 0, { ...tf('Editada'), active: false })).version).toBe(1);
    await expect(service.editQuestion('teacher', question!.id, 0, tf('Vieja'))).rejects.toThrow('CONFLICT');
    await expect(service.editQuestion('teacher', 'missing', 0, tf('x'))).rejects.toThrow('NOT_FOUND');
  });
  it('creates, edits, publishes (snapshot + audit) and closes assessments with weight limits', async () => {
    const bank = await bankWithQuestions(); const created = await service.create('teacher', 'course', quizInput(bank.id));
    await expect(service.create('teacher', 'course', { ...quizInput(bank.id), weight: 51 })).rejects.toThrow('WEIGHT_EXCEEDED');
    await expect(service.create('teacher', 'course', { ...quizInput('missing') })).rejects.toThrow('INVALID_INPUT');
    await expect(service.create('other', 'course', quizInput(bank.id))).rejects.toThrow('FORBIDDEN');
    const edited = await service.edit('teacher', created.id, 0, { ...quizInput(bank.id), title: 'Práctica calificada' }); expect(edited.revision).toBe(1);
    await expect(service.edit('teacher', created.id, 0, quizInput(bank.id))).rejects.toThrow('CONFLICT');
    await expect(service.edit('teacher', created.id, -1, quizInput(bank.id))).rejects.toThrow('INVALID_INPUT');
    course.status = 'BORRADOR'; await expect(service.publish('teacher', created.id, 1)).rejects.toThrow('COURSE_NOT_PUBLISHED'); course.status = 'PUBLICADO';
    const published = await service.publish('teacher', created.id, 1); expect(published.status).toBe('PUBLISHED'); expect(snapshots.get(created.id)).toHaveLength(2);
    expect(audits).toEqual(['teacher:PUBLISHED']);
    await expect(service.remove('teacher', created.id, 2)).rejects.toThrow('INVALID_STATE');
    expect((await service.close('teacher', created.id, 2)).status).toBe('CLOSED');
    const draft = await service.create('teacher', 'course', { title: 'Ensayo', instructions: '', type: 'RUBRIC', weight: 50, dueAt: '2026-12-01T00:00:00Z', criteria: [{ description: 'Contenido', maxPoints: 20 }] });
    await service.remove('teacher', draft.id, 0); expect(assessments.has(draft.id)).toBe(false);
    await expect(service.close('teacher', 'missing', 0)).rejects.toThrow('NOT_FOUND');
  });
  it('shows students only published assessments of enrolled published courses, never banks or answers', async () => {
    const bank = await bankWithQuestions(); const created = await service.create('teacher', 'course', quizInput(bank.id));
    expect(await service.list('student', 'course')).toEqual([]); expect(await service.list('designer', 'course')).toHaveLength(1);
    await service.publish('teacher', created.id, 0);
    const [view] = await service.list('student', 'course'); expect(view).not.toHaveProperty('bankId'); expect(JSON.stringify(view)).not.toContain('correct');
    enrolled = false; await expect(service.list('student', 'course')).rejects.toThrow('FORBIDDEN');
    enrolled = true; course.status = 'ARCHIVADO'; await expect(service.list('student', 'course')).rejects.toThrow('FORBIDDEN');
    await expect(service.list('other', 'course')).rejects.toThrow('FORBIDDEN');
  });
  it('previews random draws for teachers from the bank (draft) or the frozen snapshot (published)', async () => {
    const bank = await bankWithQuestions(3); const created = await service.create('teacher', 'course', quizInput(bank.id));
    const draft = await service.preview('teacher', created.id); expect(draft).toMatchObject({ poolSize: 3 }); expect(draft.questions).toHaveLength(2);
    await service.publish('teacher', created.id, 0); await service.addQuestion('teacher', bank.id, tf('Agregada después'));
    const published = await service.preview('teacher', created.id); expect(published.poolSize).toBe(3);
    await expect(service.preview('student', created.id)).rejects.toThrow('FORBIDDEN');
    const rubric = await service.create('teacher', 'course', { title: 'R', instructions: '', type: 'RUBRIC', weight: 10, dueAt: '2026-12-01T00:00:00Z', criteria: [{ description: 'C', maxPoints: 5 }] });
    await expect(service.preview('teacher', rubric.id)).rejects.toThrow('INVALID_INPUT');
  });
  it('offers grading only published or closed assessments through the public catalog', async () => {
    const bank = await bankWithQuestions(); const created = await service.create('teacher', 'course', quizInput(bank.id));
    expect(await service.gradable('course')).toEqual([]); expect(await service.findGradable(created.id)).toBeNull();
    await service.publish('teacher', created.id, 0);
    expect(await service.findGradable(created.id)).toMatchObject({ type: 'QUIZ', weightBp: 5000, status: 'PUBLISHED' });
    expect(await service.gradable('course')).toHaveLength(1); expect(JSON.stringify(await service.gradable('course'))).not.toContain('correct');
  });
});
