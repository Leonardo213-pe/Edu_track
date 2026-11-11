import { describe, expect, it } from 'vitest';
import { Attempt, expiryFor, validVersion, type AttemptQuestion, type ExamDefinition } from './attempt';

const definition: ExamDefinition = { id: 'quiz', courseId: 'course', title: 'Práctica', status: 'PUBLISHED', type: 'QUIZ', dueAt: '2026-12-01T12:00:00.000Z', durationMinutes: 30, questionCount: 2 };
const questions: AttemptQuestion[] = [
  { questionId: 'q1', position: 0, type: 'SINGLE', statement: 'Uno', pointsCents: 100, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] },
  { questionId: 'q2', position: 1, type: 'MULTIPLE', statement: 'Dos', pointsCents: 200, options: [{ id: 'x', text: 'X' }, { id: 'y', text: 'Y' }, { id: 'z', text: 'Z' }] },
];
const start = (now = '2026-12-01T10:00:00.000Z') => Attempt.start('attempt', definition, 'student', questions, new Date(now));

describe('exam attempt (CU-03)', () => {
  it('fixes the deadline on the server: start + duration, never after the due date', () => {
    expect(expiryFor(new Date('2026-12-01T10:00:00Z'), 30, new Date('2026-12-01T12:00:00Z')).toISOString()).toBe('2026-12-01T10:30:00.000Z');
    expect(expiryFor(new Date('2026-12-01T11:50:00Z'), 30, new Date('2026-12-01T12:00:00Z')).toISOString()).toBe('2026-12-01T12:00:00.000Z');
    expect(start().data).toMatchObject({ status: 'IN_PROGRESS', expiresAt: '2026-12-01T10:30:00.000Z', finalizedAt: null, finalizedBy: null });
    expect(start('2026-12-01T11:45:00.000Z').data.expiresAt).toBe('2026-12-01T12:00:00.000Z');
  });
  it('starts only published quizzes before the due date and never stores correct flags', () => {
    for (const bad of [{ ...definition, status: 'CLOSED' }, { ...definition, status: 'DRAFT' }, { ...definition, type: 'RUBRIC' }, { ...definition, durationMinutes: null }])
      expect(() => Attempt.start('a', bad, 's', questions, new Date('2026-12-01T10:00:00Z'))).toThrow('NOT_AVAILABLE');
    expect(() => start('2026-12-01T12:00:00.000Z')).toThrow('NOT_AVAILABLE');
    expect(() => Attempt.start('a', definition, 's', [], new Date('2026-12-01T10:00:00Z'))).toThrow('INVALID_INPUT');
    const leaked = [{ ...questions[0]!, options: [{ id: 'a', text: 'A', correct: true }] as unknown as AttemptQuestion['options'] }];
    expect(() => Attempt.start('a', definition, 's', leaked, new Date('2026-12-01T10:00:00Z'))).toThrow('INVALID_INPUT');
    expect(JSON.stringify(start().data)).not.toContain('correct');
  });
  it('is open only before its deadline and reports remaining seconds from the server clock', () => {
    const attempt = start();
    expect(attempt.isOpen(new Date('2026-12-01T10:29:59.000Z'))).toBe(true); expect(attempt.isOpen(new Date('2026-12-01T10:30:00.000Z'))).toBe(false);
    expect(attempt.remainingSeconds(new Date('2026-12-01T10:29:00.500Z'))).toBe(60); expect(attempt.remainingSeconds(new Date('2026-12-01T11:00:00Z'))).toBe(0);
    expect(Attempt.restore({ ...attempt.data, status: 'SUBMITTED' }).isOpen(new Date('2026-12-01T10:01:00Z'))).toBe(false);
  });
  it('validates and normalizes answers by question type; only the owner may answer', () => {
    const attempt = start();
    expect(attempt.validateAnswer('q1', ['b'])).toEqual(['b']); expect(attempt.validateAnswer('q1', [])).toEqual([]);
    expect(attempt.validateAnswer('q2', ['z', 'x', 'x'])).toEqual(['x', 'z']);
    expect(() => attempt.validateAnswer('q1', ['a', 'b'])).toThrow('INVALID_INPUT'); expect(() => attempt.validateAnswer('q1', ['other'])).toThrow('INVALID_INPUT');
    expect(() => attempt.validateAnswer('q1', 'a')).toThrow('INVALID_INPUT'); expect(() => attempt.validateAnswer('q1', [1])).toThrow('INVALID_INPUT');
    expect(() => attempt.validateAnswer('missing', ['a'])).toThrow('NOT_FOUND');
    expect(() => attempt.ownedBy('student')).not.toThrow(); expect(() => attempt.ownedBy('intruder')).toThrow('FORBIDDEN');
  });
  it('accepts only positive safe integer versions', () => {
    expect(validVersion(1)).toBe(1); expect(validVersion(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const bad of [0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1, null]) expect(() => validVersion(bad)).toThrow('INVALID_INPUT');
  });
});
