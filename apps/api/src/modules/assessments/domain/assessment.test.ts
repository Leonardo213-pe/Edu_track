import { describe, expect, it } from 'vitest';
import { Assessment, draw, ensureWeights, type AssessmentInput } from './assessment';
import { Question, toCents, type QuestionInput } from './question';

let counter = 0; const newId = () => `id-${++counter}`;
const now = '2026-11-13T00:00:00.000Z';
const single: QuestionInput = { type: 'SINGLE', statement: '¿Capital del Perú?', points: 2, options: [{ text: 'Lima', correct: true }, { text: 'Cusco', correct: false }] };
function question(id: string, input: Partial<QuestionInput> = {}) { return Question.create(id, 'bank', { ...single, ...input }, newId, now); }
const quiz: AssessmentInput = { title: 'Práctica 1', instructions: 'Lee bien', type: 'QUIZ', weight: 30, dueAt: '2026-12-01T10:00:00Z', durationMinutes: 45, questionCount: 2, bankId: 'bank' };
const rubric: AssessmentInput = { title: 'Ensayo', instructions: '', type: 'RUBRIC', weight: 40, dueAt: '2026-12-05T10:00:00Z',
  criteria: [{ description: 'Argumentación', maxPoints: 10 }, { description: 'Redacción', maxPoints: 5.5 }] };

describe('question bank rules', () => {
  it('validates each question type and keeps answers inside the domain', () => {
    expect(question('q1').data).toMatchObject({ type: 'SINGLE', pointsCents: 200, active: true, version: 0 });
    expect(Question.create('q2', 'bank', { type: 'MULTIPLE', statement: 'Primos', points: 1.5, options: [{ text: '2', correct: true }, { text: '3', correct: true }, { text: '4', correct: false }] }, newId, now).data.options.filter(o => o.correct)).toHaveLength(2);
    expect(Question.create('q3', 'bank', { type: 'TRUE_FALSE', statement: 'La Tierra es plana', points: 1, options: [{ text: 'Verdadero', correct: false }, { text: 'Falso', correct: true }] }, newId, now).data.type).toBe('TRUE_FALSE');
    const invalid: Partial<QuestionInput>[] = [
      { options: [{ text: 'A', correct: true }, { text: 'B', correct: true }] }, { options: [{ text: 'A', correct: false }, { text: 'B', correct: false }] },
      { options: [{ text: 'A', correct: true }] }, { options: [{ text: 'A', correct: true }, { text: 'a', correct: false }] },
      { type: 'MULTIPLE', options: [{ text: 'A', correct: false }, { text: 'B', correct: false }] },
      { type: 'TRUE_FALSE', options: [{ text: 'Sí', correct: true }, { text: 'No', correct: false }] },
      { points: 0 }, { points: 1.234 }, { points: 101 }, { statement: ' ' }, { type: 'ESSAY' as 'SINGLE' },
    ];
    for (const input of invalid) expect(() => question('bad', input)).toThrow('INVALID_INPUT');
  });
  it('revises with a new version and preserves identity and creation date', () => {
    const original = question('q1'); const revised = original.revise({ ...single, statement: 'Actualizada', active: false }, newId);
    expect(revised.data).toMatchObject({ id: 'q1', version: 1, statement: 'Actualizada', active: false, createdAt: now });
    expect(original.data.statement).toBe('¿Capital del Perú?');
  });
  it('converts decimals to exact hundredths', () => {
    expect(toCents(0.1 + 0.2, 0, 100)).toBe(30); expect(toCents(19.99, 0, 2000)).toBe(1999);
    for (const bad of [NaN, Infinity, '5', 1.005]) expect(() => toCents(bad, 0, 2000)).toThrow('INVALID_INPUT');
  });
});

describe('assessment lifecycle (State) and snapshots', () => {
  it('validates quiz and rubric definitions', () => {
    expect(Assessment.create('a', 'course', quiz, newId, now).data).toMatchObject({ status: 'DRAFT', weightBp: 3000, durationMinutes: 45, questionCount: 2, criteria: [] });
    const r = Assessment.create('r', 'course', rubric, newId, now); expect(r.maxRubricCents()).toBe(1550); expect(r.data.bankId).toBeNull(); expect(r.data.durationMinutes).toBeNull();
    for (const input of [{ ...quiz, bankId: null }, { ...quiz, durationMinutes: 0 }, { ...quiz, questionCount: 1.5 }, { ...quiz, weight: 0 }, { ...quiz, dueAt: 'mañana' },
      { ...rubric, criteria: [] }, { ...quiz, type: 'ORAL' as 'QUIZ' }, { ...quiz, title: '' }]) expect(() => Assessment.create('x', 'course', input, newId, now)).toThrow('INVALID_INPUT');
  });
  it('publishes only in a published course with enough active bank questions, freezing the pool', () => {
    const assessment = Assessment.create('a', 'course', quiz, newId, now); const pool = [question('q1').data, question('q2', { statement: 'Otra' }).data];
    expect(() => assessment.publish(pool, false, now)).toThrow('COURSE_NOT_PUBLISHED');
    expect(() => assessment.publish([pool[0]!, { ...pool[1]!, active: false }], true, now)).toThrow('INSUFFICIENT_QUESTIONS');
    expect(() => assessment.publish([pool[0]!, { ...pool[1]!, bankId: 'other' }], true, now)).toThrow('INSUFFICIENT_QUESTIONS');
    const snapshot = assessment.publish(pool, true, now);
    expect(snapshot.map(item => [item.questionId, item.position])).toEqual([['q1', 0], ['q2', 1]]); expect(snapshot[0]!.options[0]!.correct).toBe(true);
    expect(assessment.data).toMatchObject({ status: 'PUBLISHED', publishedAt: now }); expect(assessment.visibleToStudents()).toBe(true); expect(assessment.acceptsGrades()).toBe(true);
    expect(() => assessment.publish(pool, true, now)).toThrow('INVALID_STATE');
    expect(Assessment.create('r', 'course', rubric, newId, now).publish([], true, now)).toEqual([]);
  });
  it('lets published assessments change only their schedule, and closed ones nothing', () => {
    const assessment = Assessment.create('r', 'course', rubric, newId, now);
    assessment.edit({ ...rubric, criteria: [{ description: 'Única', maxPoints: 20 }] }, newId); expect(assessment.maxRubricCents()).toBe(2000);
    assessment.publish([], true, now);
    assessment.edit({ ...rubric, title: 'Ensayo final', weight: 35, criteria: [{ description: 'Única', maxPoints: 20 }] }, newId);
    expect(assessment.data).toMatchObject({ title: 'Ensayo final', weightBp: 3500 });
    expect(() => assessment.edit({ ...rubric, criteria: [{ description: 'Cambiada', maxPoints: 20 }] }, newId)).toThrow('INVALID_STATE');
    expect(() => assessment.removable()).toThrow('INVALID_STATE');
    assessment.close(); expect(assessment.acceptsGrades()).toBe(true); expect(() => assessment.close()).toThrow('INVALID_STATE');
    expect(() => assessment.edit({ ...rubric, criteria: [{ description: 'Única', maxPoints: 20 }] }, newId)).toThrow('INVALID_STATE');
    const draft = Assessment.create('d', 'course', quiz, newId, now); expect(draft.visibleToStudents()).toBe(false); expect(draft.acceptsGrades()).toBe(false);
    expect(() => draft.close()).toThrow('INVALID_STATE'); expect(() => draft.removable()).not.toThrow();
    const published = Assessment.create('p', 'course', quiz, newId, now); published.publish([question('q1').data, question('q2', { statement: 'B' }).data], true, now);
    expect(() => published.edit({ ...quiz, questionCount: 1 }, newId)).toThrow('INVALID_STATE');
  });
  it('never exposes bank or internal fields in the student view', () => {
    const view = Assessment.create('a', 'course', quiz, newId, now).publicView();
    expect(view).not.toHaveProperty('bankId'); expect(view).not.toHaveProperty('revision'); expect(view).toMatchObject({ title: 'Práctica 1', questionCount: 2 });
  });
  it('keeps the course weight total at or below 100%', () => {
    const a = Assessment.create('a', 'course', { ...quiz, weight: 60 }, newId, now); const b = Assessment.create('b', 'course', { ...rubric, weight: 40 }, newId, now);
    expect(() => ensureWeights([a], b)).not.toThrow(); expect(() => ensureWeights([a, b], b)).not.toThrow();
    expect(() => ensureWeights([a], Assessment.create('c', 'course', { ...rubric, weight: 40.01 }, newId, now))).toThrow('WEIGHT_EXCEEDED');
  });
  it('draws without repetition, honours the injected random source and rejects impossible draws', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    expect(draw(pool, 3, () => 0)).toEqual(['a', 'b', 'c']); expect(draw(pool, 2, () => 0.999)).toEqual(['e', 'a']);
    let seed = 7; const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) { const result = draw(pool, 3, random); expect(new Set(result).size).toBe(3); result.forEach(item => seen.add(item)); }
    expect(seen.size).toBe(5); expect(pool).toEqual(['a', 'b', 'c', 'd', 'e']);
    for (const count of [0, 6, 1.5]) expect(() => draw(pool, count, Math.random)).toThrow('INSUFFICIENT_QUESTIONS');
  });
});
