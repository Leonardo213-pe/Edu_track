import { beforeEach, describe, expect, it } from 'vitest';
import { ExamService } from './exam-service';
import { Attempt, ExamError, type AttemptQuestion, type ExamDefinition, type SavedAnswer } from '../domain/attempt';
import type { ExamRepository } from './ports';

const roles: Record<string, string> = { ana: 'STUDENT', beto: 'STUDENT', teacher: 'TEACHER', other: 'TEACHER', admin: 'ADMIN' };
const drawn: AttemptQuestion[] = [
  { questionId: 'q1', position: 0, type: 'SINGLE', statement: 'Uno', pointsCents: 100, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] },
  { questionId: 'q2', position: 1, type: 'TRUE_FALSE', statement: 'Dos', pointsCents: 100, options: [{ id: 'v', text: 'Verdadero' }, { id: 'f', text: 'Falso' }] },
];
let now: Date, definition: ExamDefinition, attempts: Map<string, Attempt>, answers: Map<string, SavedAnswer>, events: string[], enrolled: Set<string>, recorded: unknown[];
let service: ExamService, courseStatus: string;
beforeEach(() => {
  now = new Date('2026-12-01T10:00:00.000Z'); courseStatus = 'PUBLICADO'; enrolled = new Set(['ana', 'beto']); events = []; recorded = [];
  definition = { id: 'quiz', courseId: 'course', title: 'Práctica', status: 'PUBLISHED', type: 'QUIZ', dueAt: '2026-12-01T12:00:00.000Z', durationMinutes: 30, questionCount: 2 };
  attempts = new Map(); answers = new Map();
  // Explicit in-memory double: the PostgreSQL adapter (DB clock, SQL version guard, outbox) is covered by integration tests.
  const close = (attempt: Attempt) => {
    const expired = now.getTime() >= new Date(attempt.data.expiresAt).getTime();
    const next = Attempt.restore({ ...attempt.data, status: expired ? 'EXPIRED' : 'SUBMITTED', finalizedBy: expired ? 'TIMEOUT' : 'STUDENT', finalizedAt: now.toISOString() });
    attempts.set(next.data.id, next); events.push(next.data.id); return next;
  };
  const repo: ExamRepository = {
    now: async () => now, find: async id => attempts.get(id) ?? null,
    findByStudent: async (assessmentId, studentId) => [...attempts.values()].find(item => item.data.assessmentId === assessmentId && item.data.studentId === studentId) ?? null,
    forAssessment: async id => [...attempts.values()].filter(item => item.data.assessmentId === id).map(attempt => ({ attempt, answered: [...answers.keys()].filter(key => key.startsWith(attempt.data.id)).length })),
    answers: async id => [...answers.entries()].filter(([key]) => key.startsWith(`${id}:`)).map(([, value]) => value),
    create: async attempt => { attempts.set(attempt.data.id, attempt); return attempt; },
    saveAnswer: async (attemptId, questionId, optionIds, version) => {
      if (!attempts.get(attemptId)!.isOpen(now)) throw new ExamError('ATTEMPT_CLOSED');
      const key = `${attemptId}:${questionId}`; const stored = answers.get(key);
      if (stored && stored.version >= version) return { accepted: false, ...stored, optionIds: [...stored.optionIds] };
      const saved = { questionId, optionIds, version, savedAt: now.toISOString() }; answers.set(key, saved); return { accepted: true, ...saved };
    },
    finalize: async id => { const attempt = attempts.get(id)!; return attempt.data.status === 'IN_PROGRESS' ? close(attempt) : attempt; },
    expireDue: async () => { let count = 0; for (const attempt of attempts.values()) if (attempt.data.status === 'IN_PROGRESS' && !attempt.isOpen(now)) { close(attempt); count++; } return count; },
  };
  let id = 0;
  service = new ExamService(repo, {
    definition: async id => id === definition.id ? definition : null, draw: async () => drawn,
    answerKey: async () => [{ questionId: 'q1', pointsCents: 100, correctOptionIds: ['a'] }, { questionId: 'q2', pointsCents: 100, correctOptionIds: ['v'] }, { questionId: 'unused', pointsCents: 500, correctOptionIds: ['x'] }],
  }, { describe: async () => ({ id: 'course', teacherId: 'teacher', status: courseStatus }) }, { has: async studentId => enrolled.has(studentId) },
  { role: async id => roles[id] ?? null, names: async ids => new Map(ids.map(item => [item, item.toUpperCase()])) },
  { recordAutomatic: async input => { recorded.push(input); return { scoreCents: 1000 }; }, scoreOf: async () => recorded.length ? 1000 : null }, { id: () => `attempt-${++id}` });
});

describe('exam use cases', () => {
  it('starts one attempt per student (idempotent) only for eligible enrolled students', async () => {
    const first = await service.start('ana', 'quiz'); const again = await service.start('ana', 'quiz');
    expect(again.id).toBe(first.id); expect(first).toMatchObject({ status: 'IN_PROGRESS', remainingSeconds: 1800, questionCount: 2, answers: [] });
    expect(JSON.stringify(first.questions)).not.toContain('correct');
    await expect(service.start('teacher', 'quiz')).rejects.toThrow('FORBIDDEN');
    enrolled.delete('beto'); await expect(service.start('beto', 'quiz')).rejects.toThrow('FORBIDDEN');
    enrolled.add('beto'); courseStatus = 'ARCHIVADO'; await expect(service.start('beto', 'quiz')).rejects.toThrow('FORBIDDEN');
    courseStatus = 'PUBLICADO'; await expect(service.start('beto', 'missing')).rejects.toThrow('NOT_FOUND');
    definition = { ...definition, status: 'CLOSED' }; await expect(service.start('beto', 'quiz')).rejects.toThrow('NOT_AVAILABLE');
    expect(await service.status('beto', 'quiz')).toMatchObject({ canStart: false, attempt: null });
  });
  it('saves versioned answers idempotently and lets only the owner act', async () => {
    const attempt = await service.start('ana', 'quiz');
    expect(await service.saveAnswer('ana', attempt.id, 'q1', ['b'], 1)).toMatchObject({ accepted: true, version: 1, optionIds: ['b'] });
    expect(await service.saveAnswer('ana', attempt.id, 'q1', ['a'], 3)).toMatchObject({ accepted: true, version: 3, optionIds: ['a'] });
    expect(await service.saveAnswer('ana', attempt.id, 'q1', ['b'], 2)).toMatchObject({ accepted: false, version: 3, optionIds: ['a'] });
    await expect(service.saveAnswer('ana', attempt.id, 'q1', ['a', 'b'], 4)).rejects.toThrow('INVALID_INPUT');
    await expect(service.saveAnswer('ana', attempt.id, 'q1', ['a'], 0)).rejects.toThrow('INVALID_INPUT');
    await expect(service.saveAnswer('beto', attempt.id, 'q1', ['a'], 5)).rejects.toThrow('FORBIDDEN');
    await expect(service.view('beto', attempt.id)).rejects.toThrow('FORBIDDEN'); await expect(service.view('ana', 'missing')).rejects.toThrow('NOT_FOUND');
    expect((await service.view('ana', attempt.id)).answers).toEqual([{ questionId: 'q1', optionIds: ['a'], version: 3 }]);
  });
  it('finalizes once, closes expired attempts lazily and by the sweeper, and rejects later answers', async () => {
    const ana = await service.start('ana', 'quiz'); const beto = await service.start('beto', 'quiz');
    const finalized = await service.finalize('ana', ana.id); expect(finalized).toMatchObject({ status: 'SUBMITTED', finalizedBy: 'STUDENT', remainingSeconds: 0 });
    await service.finalize('ana', ana.id); expect(events).toEqual([ana.id]);
    await expect(service.saveAnswer('ana', ana.id, 'q1', ['a'], 9)).rejects.toThrow('ATTEMPT_CLOSED');
    now = new Date('2026-12-01T10:31:00.000Z');
    expect((await service.status('beto', 'quiz')).attempt).toMatchObject({ status: 'EXPIRED', finalizedBy: 'TIMEOUT' }); expect(events).toEqual([ana.id, beto.id]);
    expect(await service.expire()).toBe(0);
  });
  it('grades only the drawn questions of a finalized attempt through the automatic grade contract', async () => {
    const attempt = await service.start('ana', 'quiz'); await service.saveAnswer('ana', attempt.id, 'q1', ['a'], 1);
    await expect(service.handleFinalized({ attemptId: attempt.id })).rejects.toThrow('NOT_FOUND');
    await service.finalize('ana', attempt.id); await service.handleFinalized({ attemptId: attempt.id });
    expect(recorded).toEqual([{ assessmentId: 'quiz', courseId: 'course', studentId: 'ana', sourceId: attempt.id,
      questions: [{ questionId: 'q1', pointsCents: 100, correctOptionIds: ['a'] }, { questionId: 'q2', pointsCents: 100, correctOptionIds: ['v'] }], answers: { q1: ['a'] } }]);
    expect((await service.view('ana', attempt.id)).score).toBe(10);
    await expect(service.handleFinalized({ attemptId: 'missing' })).rejects.toThrow('NOT_FOUND');
  });
  it('lets the responsible teacher or an admin follow attempts without answers', async () => {
    await service.start('ana', 'quiz'); const list = await service.attempts('teacher', 'quiz');
    expect(list).toEqual([expect.objectContaining({ displayName: 'ANA', status: 'IN_PROGRESS', answered: 0, score: null })]); expect(list[0]).not.toHaveProperty('questions');
    expect(await service.attempts('admin', 'quiz')).toHaveLength(1);
    for (const actor of ['other', 'ana']) await expect(service.attempts(actor, 'quiz')).rejects.toThrow('FORBIDDEN');
    await expect(service.attempts('teacher', 'missing')).rejects.toThrow('NOT_FOUND');
  });
});
