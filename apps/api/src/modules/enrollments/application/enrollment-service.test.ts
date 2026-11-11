import { beforeEach, describe, expect, it } from 'vitest';
import { EnrollmentService } from './enrollment-service';
import { reconcile, type Reconciliation, type RosterEntry } from '../domain/enrollment';
import type { DirectoryUser, EnrollmentRepository, EnrollmentRun } from './ports';

const people: DirectoryUser[] = [
  { id: 'admin', email: 'admin@example.test', displayName: 'Admin', role: 'ADMIN', active: true },
  { id: 'ana', email: 'ana@example.test', displayName: 'Ana', role: 'STUDENT', active: true },
  { id: 'beto', email: 'beto@example.test', displayName: 'Beto', role: 'STUDENT', active: true },
  { id: 'carla', email: 'carla@example.test', displayName: 'Carla', role: 'STUDENT', active: true },
  { id: 'inactive', email: 'old@example.test', displayName: 'Old', role: 'STUDENT', active: false },
  { id: 'teacher', email: 'doc@example.test', displayName: 'Docente', role: 'TEACHER', active: true },
];
let rows: Map<string, RosterEntry & { courseId: string }>, runs: EnrollmentRun[], service: EnrollmentService;
beforeEach(() => {
  rows = new Map(); runs = [];
  // Explicit in-memory double of the persistence port; integration tests use PostgreSQL.
  const repo: EnrollmentRepository = {
    isEnrolled: async (studentId, courseId) => !!rows.get(`${studentId}:${courseId}`)?.active,
    activeCourses: async studentId => [...rows.values()].filter(row => row.studentId === studentId && row.active).map(row => row.courseId),
    roster: async courseId => [...rows.values()].filter(row => row.courseId === courseId),
    reconcile: async (courseId, decide, run) => {
      const result: Reconciliation = decide([...rows.values()].filter(row => row.courseId === courseId));
      for (const studentId of result.activate) rows.set(`${studentId}:${courseId}`, { studentId, courseId, active: true });
      for (const studentId of result.deactivate) rows.set(`${studentId}:${courseId}`, { studentId, courseId, active: false });
      runs.unshift({ ...run, added: result.activate.length, removed: result.deactivate.length, total: result.total }); return result;
    },
    runs: async (courseId, limit) => runs.filter(run => run.courseId === courseId).slice(0, limit),
  };
  let id = 0;
  service = new EnrollmentService(repo, {
    byIds: async ids => people.filter(person => ids.includes(person.id)),
    byEmails: async emails => people.filter(person => emails.includes(person.email)),
  }, { id: () => `run-${++id}`, now: () => '2026-11-12T02:00:00.000Z' });
});
describe('enrollment projection', () => {
  it('reconciles altas, bajas and reactivations idempotently', () => {
    expect(reconcile([], ['a', 'b', 'b'])).toEqual({ activate: ['a', 'b'], deactivate: [], unchanged: 0, total: 2 });
    const current = [{ studentId: 'a', active: true }, { studentId: 'b', active: false }, { studentId: 'c', active: true }];
    expect(reconcile(current, ['a', 'b'])).toEqual({ activate: ['b'], deactivate: ['c'], unchanged: 1, total: 2 });
    expect(reconcile([{ studentId: 'a', active: true }], ['a'])).toEqual({ activate: [], deactivate: [], unchanged: 1, total: 1 });
    expect(() => reconcile([], Array.from({ length: 1001 }, (_, index) => `s${index}`))).toThrow('INVALID_INPUT');
    expect(() => reconcile([], [''])).toThrow('INVALID_INPUT');
  });
  it('synchronizes the official list, records each run and answers the public access contract', async () => {
    const first = await service.synchronize('admin', 'course', [' ANA@example.test', 'beto@example.test', 'ana@example.test']);
    expect(first).toMatchObject({ added: 2, removed: 0, total: 2, students: [{ id: 'ana', displayName: 'Ana' }, { id: 'beto', displayName: 'Beto' }] });
    expect(await service.isEnrolled('ana', 'course')).toBe(true); expect(await service.coursesOf('ana')).toEqual(['course']);
    const second = await service.synchronize('admin', 'course', ['beto@example.test', 'carla@example.test']);
    expect(second).toMatchObject({ added: 1, removed: 1, unchanged: 1, total: 2 }); expect(await service.isEnrolled('ana', 'course')).toBe(false);
    const again = await service.synchronize('admin', 'course', ['beto@example.test', 'carla@example.test']);
    expect(again).toMatchObject({ added: 0, removed: 0, unchanged: 2 }); expect(again.runs.map(run => run.id)).toEqual(['run-3', 'run-2', 'run-1']);
    expect((await service.synchronize('admin', 'course', [])).removed).toBe(2); expect(await service.coursesOf('beto')).toEqual([]);
  });
  it('rejects unknown, inactive or non-student accounts without applying a partial roster', async () => {
    await expect(service.synchronize('admin', 'course', ['ana@example.test', 'nobody@example.test', 'old@example.test', 'doc@example.test']))
      .rejects.toMatchObject({ code: 'UNKNOWN_STUDENTS', details: ['nobody@example.test', 'old@example.test', 'doc@example.test'] });
    expect(rows.size).toBe(0); expect(runs).toHaveLength(0);
    await expect(service.synchronize('admin', 'course', Array.from({ length: 1001 }, (_, index) => `s${index}@example.test`))).rejects.toThrow('INVALID_INPUT');
  });
  it('allows only active administrators to read or replace the roster', async () => {
    for (const actor of ['ana', 'teacher', 'missing']) {
      await expect(service.roster(actor, 'course')).rejects.toThrow('FORBIDDEN');
      await expect(service.synchronize(actor, 'course', [])).rejects.toThrow('FORBIDDEN');
    }
    expect(await service.roster('admin', 'course')).toEqual({ courseId: 'course', students: [], runs: [] });
  });
});
