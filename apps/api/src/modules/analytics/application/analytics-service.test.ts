import { beforeEach, describe, expect, it } from 'vitest';
import { AnalyticsService } from './analytics-service';
import { DEFAULT_RULES, assessRisk, daysSince, validateRules, type RiskRules } from '../domain/risk';
import type { AnalyticsRepository } from './ports';

const roles: Record<string, string> = { teacher: 'TEACHER', other: 'TEACHER', admin: 'ADMIN', designer: 'INSTRUCTIONAL_DESIGNER', ana: 'STUDENT', beto: 'STUDENT', carla: 'STUDENT' };
const now = new Date('2026-11-20T12:00:00.000Z');
let stored: (RiskRules & { updatedBy: string; updatedAt: string }) | null, beats: string[], service: AnalyticsService, enrolled: Set<string>;
beforeEach(() => {
  stored = null; beats = []; enrolled = new Set(['ana', 'beto', 'carla']);
  // Explicit in-memory double; the SQL heartbeat throttle and aggregation are covered by integration tests.
  const repo: AnalyticsRepository = {
    heartbeat: async (userId, courseId) => { beats.push(`${userId}:${courseId}`); return beats.length; },
    activity: async () => [{ userId: 'ana', totalMinutes: 120, lastWeekMinutes: 30, lastSeenAt: new Date('2026-11-19T12:00:00Z') },
      { userId: 'beto', totalMinutes: 5, lastWeekMinutes: 0, lastSeenAt: new Date('2026-11-01T12:00:00Z') }],
    rules: async () => stored, saveRules: async (_course, rules, actor) => { stored = { ...rules, updatedBy: actor, updatedAt: now.toISOString() }; },
  };
  service = new AnalyticsService(repo, { role: async id => roles[id] ?? null, names: async ids => new Map(ids.map(id => [id, id.toUpperCase()])) },
    { describe: async id => id === 'course' ? { id, code: 'C', name: 'Curso', teacherId: 'teacher', status: 'PUBLICADO' } : null,
      progressOf: async () => [{ studentId: 'ana', percentage: 80 }, { studentId: 'beto', percentage: 20 }] },
    { has: async studentId => enrolled.has(studentId), studentsOf: async () => [...enrolled] },
    { standing: async () => [{ studentId: 'ana', currentCents: 1500, gradedAssessmentIds: ['a1', 'a2'] }, { studentId: 'beto', currentCents: 900, gradedAssessmentIds: ['a1'] },
      { studentId: 'carla', currentCents: null, gradedAssessmentIds: [] }] },
    { gradable: async () => [{ id: 'a1', dueAt: '2026-11-10T00:00:00Z' }, { id: 'a2', dueAt: '2026-11-15T00:00:00Z' }, { id: 'a3', dueAt: '2026-12-01T00:00:00Z' }] },
    { now: () => now });
});
describe('risk rules (no ML)', () => {
  it('explains every triggered rule and derives the level from their number', () => {
    expect(assessRisk({ progress: 90, averageCents: 1600, inactiveDays: 1, missed: 0 }, DEFAULT_RULES)).toEqual({ level: 'BAJO', reasons: [] });
    expect(assessRisk({ progress: 30, averageCents: null, inactiveDays: 2, missed: 0 }, DEFAULT_RULES)).toEqual({ level: 'MEDIO', reasons: ['Avance de contenidos 30% (mínimo 50%)'] });
    expect(assessRisk({ progress: 10, averageCents: 900, inactiveDays: null, missed: 3 }, DEFAULT_RULES).reasons).toEqual(['Avance de contenidos 10% (mínimo 50%)',
      'Promedio 9.00 (mínimo 11.00)', 'Sin actividad registrada en el curso', '3 evaluaciones vencidas sin calificación (límite 2)']);
    expect(assessRisk({ progress: 60, averageCents: 1200, inactiveDays: 9, missed: 2 }, DEFAULT_RULES).level).toBe('ALTO');
    expect(daysSince(null, now)).toBeNull(); expect(daysSince(new Date('2026-11-18T13:00:00Z'), now)).toBe(1);
  });
  it('validates configurable thresholds', () => {
    expect(validateRules({ minProgress: 60, minAverage: 10.5, maxInactiveDays: 5, maxMissed: 1 })).toEqual({ minProgress: 60, minAverageCents: 1050, maxInactiveDays: 5, maxMissed: 1 });
    for (const bad of [{ minProgress: 101 }, { minAverage: 20.5 }, { minAverage: 10.555 }, { maxInactiveDays: 0 }, { maxMissed: 1.5 }, { minAverage: '11' }])
      expect(() => validateRules({ minProgress: 50, minAverage: 11, maxInactiveDays: 7, maxMissed: 2, ...bad })).toThrow('INVALID_INPUT');
  });
});
describe('analytics use cases (CU-11)', () => {
  it('builds the course dashboard with progress, grades, connection time, missed assessments and risk', async () => {
    const view = await service.dashboard('teacher', 'course');
    expect(view.summary).toEqual({ students: 3, ALTO: 2, MEDIO: 0, BAJO: 1 }); expect(view.rules).toMatchObject({ minProgress: 50, minAverage: 11, custom: false });
    expect(view.students.map(row => [row.studentId, row.level])).toEqual([['beto', 'ALTO'], ['carla', 'ALTO'], ['ana', 'BAJO']]);
    expect(view.students.find(row => row.studentId === 'beto')).toMatchObject({ progress: 20, average: 9, missed: 1, inactiveDays: 19, totalMinutes: 5 });
    expect(view.students.find(row => row.studentId === 'carla')).toMatchObject({ progress: 0, average: null, missed: 2, inactiveDays: null, lastSeenAt: null });
    expect((await service.dashboard('designer', 'course')).students).toHaveLength(3); expect((await service.dashboard('admin', 'course')).summary.students).toBe(3);
    for (const actor of ['other', 'ana']) await expect(service.dashboard(actor, 'course')).rejects.toThrow('FORBIDDEN');
    await expect(service.dashboard('teacher', 'missing')).rejects.toThrow('NOT_FOUND');
  });
  it('lets the teacher or admin tune the rules (designer reads only), changing the outcome', async () => {
    expect(await service.rules('designer', 'course')).toMatchObject({ ...DEFAULT_RULES, custom: false });
    await expect(service.updateRules('designer', 'course', { minProgress: 10, minAverage: 5, maxInactiveDays: 30, maxMissed: 5 })).rejects.toThrow('FORBIDDEN');
    const tuned = await service.updateRules('teacher', 'course', { minProgress: 10, minAverage: 5, maxInactiveDays: 30, maxMissed: 5 });
    expect(tuned.rules).toMatchObject({ minProgress: 10, minAverage: 5, custom: true }); expect(tuned.summary).toEqual({ students: 3, ALTO: 1, MEDIO: 0, BAJO: 2 }); expect(tuned.students[0]!.studentId).toBe('carla');
    expect(await service.rules('admin', 'course')).toMatchObject({ minProgress: 10, updatedBy: 'teacher', custom: true });
  });
  it('tracks connection time only for enrolled students of a published course', async () => {
    expect(await service.heartbeat('ana', 'course')).toEqual({ tracked: true, minutesToday: 1 });
    expect(await service.heartbeat('teacher', 'course')).toEqual({ tracked: false, minutesToday: null }); expect(beats).toEqual(['ana:course']);
    enrolled.delete('carla'); await expect(service.heartbeat('carla', 'course')).rejects.toThrow('FORBIDDEN');
    await expect(service.heartbeat('ana', 'missing')).rejects.toThrow('NOT_FOUND');
  });
});
