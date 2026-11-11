import { beforeEach, describe, expect, it } from 'vitest';
import { GradingService } from './grading-service';
import { Grade, GradingError } from '../domain/grading';
import type { GradableAssessment, GradeRepository } from './ports';

const roles: Record<string, string> = { teacher: 'TEACHER', other: 'TEACHER', admin: 'ADMIN', ana: 'STUDENT', beto: 'STUDENT', designer: 'INSTRUCTIONAL_DESIGNER' };
const rubric: GradableAssessment = { id: 'essay', courseId: 'course', title: 'Ensayo', type: 'RUBRIC', weightBp: 6000, status: 'PUBLISHED', dueAt: '2026-12-01T00:00:00.000Z',
  criteria: [{ id: 'c1', description: 'Contenido', maxPointsCents: 1500 }, { id: 'c2', description: 'Forma', maxPointsCents: 500 }] };
const quiz: GradableAssessment = { ...rubric, id: 'quiz', type: 'QUIZ', weightBp: 4000, criteria: [] };
let stored: Map<string, Grade>, saves: { actor: string; version: number | null }[], courseStatus: string, service: GradingService, enrolled: Set<string>;
beforeEach(() => {
  stored = new Map(); saves = []; courseStatus = 'PUBLICADO'; enrolled = new Set(['ana', 'beto']);
  // Explicit in-memory double; the PostgreSQL adapter and its audit trigger are covered by integration tests.
  const repo: GradeRepository = {
    forCourse: async () => [...stored.values()], forStudent: async (_course, studentId) => [...stored.values()].filter(grade => grade.data.studentId === studentId),
    find: async (assessmentId, studentId) => stored.get(`${assessmentId}:${studentId}`) ?? null,
    save: async (grade, expected, actor) => {
      const key = `${grade.data.assessmentId}:${grade.data.studentId}`;
      if ((stored.get(key)?.data.version ?? null) !== expected) throw new GradingError('CONFLICT');
      stored.set(key, grade); saves.push({ actor, version: expected });
    },
  };
  let id = 0;
  service = new GradingService(repo, { gradable: async () => [rubric, quiz], findGradable: async id => [rubric, quiz].find(item => item.id === id) ?? null },
    { describe: async id => id === 'course' ? { id, code: 'CS-1', name: 'Curso', teacherId: 'teacher', status: courseStatus } : null },
    { has: async studentId => enrolled.has(studentId), studentsOf: async () => [...enrolled] },
    { role: async id => roles[id] ?? null, names: async ids => new Map(ids.map(item => [item, item.toUpperCase()])) },
    { id: () => `grade-${++id}`, now: () => '2026-11-13T00:00:00.000Z' });
});
const full = [{ criterionId: 'c1', points: 15 }, { criterionId: 'c2', points: 5 }];

describe('grading use cases', () => {
  it('lets only the responsible teacher grade enrolled students of gradable rubric assessments', async () => {
    expect(await service.gradeRubric('teacher', 'essay', 'ana', { awards: [{ criterionId: 'c1', points: 12 }, { criterionId: 'c2', points: 4 }] })).toMatchObject({ score: 16, version: 0, origin: 'RUBRIC' });
    expect(saves).toEqual([{ actor: 'teacher', version: null }]);
    for (const actor of ['other', 'admin', 'ana', 'designer']) await expect(service.gradeRubric(actor, 'essay', 'beto', { awards: full })).rejects.toThrow('FORBIDDEN');
    await expect(service.gradeRubric('teacher', 'essay', 'outsider', { awards: full })).rejects.toThrow('NOT_ENROLLED');
    await expect(service.gradeRubric('teacher', 'quiz', 'ana', { awards: full })).rejects.toThrow('NOT_GRADABLE');
    await expect(service.gradeRubric('teacher', 'missing', 'ana', { awards: full })).rejects.toThrow('NOT_GRADABLE');
    await expect(service.gradeRubric('teacher', 'essay', 'beto', { awards: full, version: 0 })).rejects.toThrow('CONFLICT');
  });
  it('changes a grade only with the current version and a reason', async () => {
    await service.gradeRubric('teacher', 'essay', 'ana', { awards: full });
    await expect(service.gradeRubric('teacher', 'essay', 'ana', { awards: full })).rejects.toThrow('CONFLICT');
    await expect(service.gradeRubric('teacher', 'essay', 'ana', { awards: full, version: 0, reason: '' })).rejects.toThrow('REASON_REQUIRED');
    const changed = await service.gradeRubric('teacher', 'essay', 'ana', { awards: [{ criterionId: 'c1', points: 10 }, { criterionId: 'c2', points: 0 }], version: 0, reason: 'Revisión solicitada' });
    expect(changed).toMatchObject({ score: 10, version: 1, reason: 'Revisión solicitada' }); expect(saves.at(-1)).toEqual({ actor: 'teacher', version: 0 });
  });
  it('builds the gradebook with weighted averages for the teacher and read-only for admins', async () => {
    await service.gradeRubric('teacher', 'essay', 'ana', { awards: full });
    const book = await service.gradebook('teacher', 'course');
    expect(book).toMatchObject({ canGrade: true, scale: { max: 20, passing: 11 }, assessments: [{ id: 'essay', weight: 60, criteria: [{ maxPoints: 15 }, { maxPoints: 5 }] }, { id: 'quiz', weight: 40 }] });
    expect(book.students.map(student => student.displayName)).toEqual(['ANA', 'BETO']);
    expect(book.students[0]!.average).toEqual({ current: 20, final: 12, finalRounded: 12, approved: true, gradedWeight: 60, totalWeight: 100, complete: false });
    expect(book.students[1]!.average).toMatchObject({ current: null, final: 0, approved: false });
    expect((await service.gradebook('admin', 'course')).canGrade).toBe(false);
    for (const actor of ['other', 'ana', 'designer']) await expect(service.gradebook(actor, 'course')).rejects.toThrow('FORBIDDEN');
    await expect(service.gradebook('teacher', 'missing')).rejects.toThrow('NOT_FOUND');
  });
  it('shows students only their own grades and average, without internal reasons', async () => {
    await service.gradeRubric('teacher', 'essay', 'ana', { awards: full }); await service.gradeRubric('teacher', 'essay', 'beto', { awards: [{ criterionId: 'c1', points: 0 }, { criterionId: 'c2', points: 0 }] });
    const mine = await service.myGrades('ana', 'course');
    expect(mine.grades).toHaveLength(1); expect(mine.grades[0]).not.toHaveProperty('reason'); expect(mine.average).toMatchObject({ final: 12, finalRounded: 12 });
    await expect(service.myGrades('teacher', 'course')).rejects.toThrow('FORBIDDEN');
    enrolled.delete('ana'); await expect(service.myGrades('ana', 'course')).rejects.toThrow('FORBIDDEN');
    enrolled.add('ana'); courseStatus = 'BORRADOR'; await expect(service.myGrades('ana', 'course')).rejects.toThrow('FORBIDDEN');
  });
});
