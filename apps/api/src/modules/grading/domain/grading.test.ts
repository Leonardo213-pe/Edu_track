import { describe, expect, it } from 'vitest';
import { AutomaticGrading, Grade, RubricGrading, roundHalfUp, strategyFor, weightedAverage } from './grading';

describe('grading rules', () => {
  it('rounds half up with integers only', () => {
    expect(roundHalfUp(1445, 100)).toBe(14); expect(roundHalfUp(1450, 100)).toBe(15); expect(roundHalfUp(1049, 100)).toBe(10); expect(roundHalfUp(1050, 100)).toBe(11);
    expect(roundHalfUp(2, 3)).toBe(1); expect(roundHalfUp(0, 7)).toBe(0);
    for (const [n, d] of [[-1, 2], [1, 0], [1.5, 2]]) expect(() => roundHalfUp(n!, d!)).toThrow('INVALID_INPUT');
  });
  it('grades objective questions all-or-nothing and scales to 0–20 (Strategy)', () => {
    const strategy = strategyFor('QUIZ'); expect(strategy).toBeInstanceOf(AutomaticGrading); expect(strategy.origin).toBe('AUTOMATIC');
    const questions = [{ questionId: 'q1', pointsCents: 200, correctOptionIds: ['a'] }, { questionId: 'q2', pointsCents: 100, correctOptionIds: ['x', 'y'] }];
    expect(strategy.grade({ questions, answers: { q1: ['a'], q2: ['x', 'y'] } }).scoreCents).toBe(2000);
    expect(strategy.grade({ questions, answers: { q1: ['a'], q2: ['x'] } }).scoreCents).toBe(1333);
    expect(strategy.grade({ questions, answers: { q1: ['a', 'b'], q2: ['y', 'x'] } }).scoreCents).toBe(667);
    expect(strategy.grade({ questions, answers: {} })).toMatchObject({ scoreCents: 0, detail: { earnedCents: 0, maxCents: 300 } });
    expect(() => strategy.grade({ questions: [], answers: {} })).toThrow('INVALID_INPUT');
  });
  it('grades rubrics criterion by criterion within their maximum', () => {
    const strategy = strategyFor('RUBRIC'); expect(strategy).toBeInstanceOf(RubricGrading);
    const criteria = [{ id: 'c1', maxPointsCents: 1000 }, { id: 'c2', maxPointsCents: 550 }];
    const result = strategy.grade({ criteria, awards: [{ criterionId: 'c1', points: 8.5 }, { criterionId: 'c2', points: 5.5 }] });
    expect(result.scoreCents).toBe(1806); expect(result.detail).toMatchObject({ earnedCents: 1400, maxCents: 1550 });
    for (const awards of [[{ criterionId: 'c1', points: 11 }, { criterionId: 'c2', points: 1 }], [{ criterionId: 'c1', points: 1 }],
      [{ criterionId: 'c1', points: 1 }, { criterionId: 'c1', points: 1 }], [{ criterionId: 'c1', points: 1 }, { criterionId: 'zz', points: 1 }],
      [{ criterionId: 'c1', points: -1 }, { criterionId: 'c2', points: 1 }], [{ criterionId: 'c1', points: 1.234 }, { criterionId: 'c2', points: 1 }]])
      expect(() => strategy.grade({ criteria, awards })).toThrow('INVALID_INPUT');
  });
  it('versions grade changes and requires a reason for every change after the first', () => {
    const first = Grade.first({ id: 'g', assessmentId: 'a', courseId: 'c', studentId: 's', gradedBy: 't', gradedAt: 'now' }, { scoreCents: 1500, detail: {} }, 'RUBRIC', '');
    expect(first.data).toMatchObject({ version: 0, reason: 'Calificación inicial', scoreCents: 1500 });
    expect(() => first.revise({ scoreCents: 1600, detail: {} }, 'RUBRIC', '  ', 't', 'later')).toThrow('REASON_REQUIRED');
    expect(() => first.revise({ scoreCents: 1600, detail: {} }, 'RUBRIC', 'x'.repeat(1001), 't', 'later')).toThrow('INVALID_INPUT');
    expect(first.revise({ scoreCents: 1600, detail: {} }, 'RUBRIC', 'Recalificación', 't2', 'later').data).toMatchObject({ version: 1, scoreCents: 1600, reason: 'Recalificación', gradedBy: 't2' });
    expect(() => Grade.first({ id: 'g', assessmentId: 'a', courseId: 'c', studentId: 's', gradedBy: 't', gradedAt: 'now' }, { scoreCents: 2001, detail: {} }, 'RUBRIC', '')).toThrow('INVALID_INPUT');
  });
  it('computes current and final weighted averages with the agreed rounding and pass mark', () => {
    expect(weightedAverage([])).toEqual({ currentCents: null, finalCents: 0, finalRounded: 0, approved: false, gradedWeightBp: 0, totalWeightBp: 0, complete: false });
    const full = weightedAverage([{ weightBp: 3000, scoreCents: 1200 }, { weightBp: 3000, scoreCents: 1000 }, { weightBp: 4000, scoreCents: 1100 }]);
    expect(full).toEqual({ currentCents: 1100, finalCents: 1100, finalRounded: 11, approved: true, gradedWeightBp: 10000, totalWeightBp: 10000, complete: true });
    expect(weightedAverage([{ weightBp: 5000, scoreCents: 1049 }, { weightBp: 5000, scoreCents: 1050 }])).toMatchObject({ finalCents: 1050, finalRounded: 11, approved: true });
    expect(weightedAverage([{ weightBp: 5000, scoreCents: 1048 }, { weightBp: 5000, scoreCents: 1050 }])).toMatchObject({ finalCents: 1049, finalRounded: 10, approved: false });
    const partial = weightedAverage([{ weightBp: 4000, scoreCents: 1600 }, { weightBp: 6000, scoreCents: null }]);
    expect(partial).toMatchObject({ currentCents: 1600, finalCents: 640, finalRounded: 6, complete: false, gradedWeightBp: 4000 });
    expect(() => weightedAverage([{ weightBp: -1, scoreCents: 10 }])).toThrow('INVALID_INPUT');
    expect(() => weightedAverage([{ weightBp: 100, scoreCents: 2001 }])).toThrow('INVALID_INPUT');
  });
});
