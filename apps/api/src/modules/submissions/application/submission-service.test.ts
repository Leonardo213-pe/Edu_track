import { beforeEach, describe, expect, it } from 'vitest';
import { SubmissionService } from './submission-service';
import { SubmissionError, type Actor, type Assignment, type CourseFacts } from '../domain/submission';
import type { FileRecord, ReceiveCommand, SubmissionRecord, SubmissionRepository } from './ports';

const actors: Record<string, Actor> = { ana: { id: 'ana', role: 'STUDENT' }, beto: { id: 'beto', role: 'STUDENT' }, out: { id: 'out', role: 'STUDENT' },
  teacher: { id: 'teacher', role: 'TEACHER' }, other: { id: 'other', role: 'TEACHER' }, admin: { id: 'admin', role: 'ADMIN' } };
let assignment: Assignment, course: CourseFacts, deadlinePassed: boolean, submissions: Map<string, SubmissionRecord>, files: Map<string, FileRecord & { courseId: string; studentId: string; assessmentId: string }>;
let removed: string[], receipts: string[], outbox: ReceiveCommand[], extractorFails: boolean, service: SubmissionService;
const pdf = (text = 'hola') => ({ bytes: new TextEncoder().encode(text), filename: 'tarea.txt', mimeType: 'text/plain' });

beforeEach(() => {
  assignment = { id: 'a1', courseId: 'c1', title: 'Ensayo', type: 'RUBRIC', status: 'PUBLISHED', dueAt: '2026-12-01T00:00:00.000Z' };
  course = { id: 'c1', teacherId: 'teacher', status: 'PUBLICADO', name: 'Curso' };
  deadlinePassed = false; submissions = new Map(); files = new Map(); removed = []; receipts = []; outbox = []; extractorFails = false;
  let id = 0, key = 0;
  // Explicit in-memory doubles of every port; PostgreSQL, the file system and the deadline clock run in integration tests.
  const repo: SubmissionRepository = {
    receive: async command => {
      if (deadlinePassed) return null;
      const current = [...submissions.values()].find(item => item.id === command.submissionId);
      const version = (current?.version ?? 0) + 1;
      const file = { id: command.fileId, submissionId: command.submissionId, version, storageKey: command.file.key, filename: command.file.filename,
        mimeType: command.file.mimeType, size: command.file.size, sha256: command.file.sha256, receivedAt: `t${version}` };
      files.set(file.id, { ...file, courseId: command.courseId, studentId: command.studentId, assessmentId: command.assessmentId });
      const record = { id: command.submissionId, assessmentId: command.assessmentId, courseId: command.courseId, studentId: command.studentId, version,
        currentFileId: file.id, firstSubmittedAt: current?.firstSubmittedAt ?? 't1', updatedAt: `t${version}`, current: file };
      submissions.set(`${command.assessmentId}:${command.studentId}`, record); outbox.push(command); return record;
    },
    find: async (assessmentId, studentId) => submissions.get(`${assessmentId}:${studentId}`) ?? null,
    forAssessment: async assessmentId => [...submissions.values()].filter(item => item.assessmentId === assessmentId),
    history: async submissionId => [...files.values()].filter(file => file.submissionId === submissionId).sort((a, b) => b.version - a.version),
    file: async fileId => files.get(fileId) ?? null,
  };
  service = new SubmissionService(repo, {
    put: async file => ({ key: `k${++key}`, filename: file.filename, mimeType: file.mimeType, size: file.bytes.length, sha256: 'x'.repeat(64) }),
    read: async () => new Uint8Array([1]), remove: async storageKey => { removed.push(storageKey); },
  }, { extract: async file => { if (extractorFails) throw new Error('bad'); return new TextDecoder().decode(file.bytes); } },
  { find: async userId => actors[userId] ?? null, names: async ids => new Map(ids.map(item => [item, item.toUpperCase()])) },
  { assignment: async id => id === assignment.id ? assignment : null, course: async id => id === course.id ? course : null,
    enrolled: async studentId => ['ana', 'beto'].includes(studentId), studentsOf: async () => ['ana', 'beto'],
    scoreOf: async (_assessmentId, studentId) => studentId === 'ana' ? 1650 : null },
  { received: async (studentId, _assignment, version) => { receipts.push(`${studentId}:v${version}`); } }, { id: () => `id-${++id}` });
});

describe('assignment submissions', () => {
  it('receives a file, keeps every replacement as a new version and emits one event per version', async () => {
    const first = await service.submit('ana', 'a1', pdf('primera'));
    expect(first.submission).toMatchObject({ version: 1, current: { filename: 'tarea.txt', version: 1 } });
    const second = await service.submit('ana', 'a1', pdf('segunda'));
    expect(second.submission).toMatchObject({ version: 2, current: { version: 2 } });
    expect(second.submission!.history.map(file => file.version)).toEqual([2, 1]);
    expect(outbox.map(command => [command.submissionId, command.text])).toEqual([[first.submission!.id, 'primera'], [first.submission!.id, 'segunda']]);
    expect(receipts).toEqual(['ana:v1', 'ana:v2']);
    expect(second.score).toBe(1650);
  });
  it('rejects late submissions with the server deadline and discards the stored bytes', async () => {
    deadlinePassed = true;
    await expect(service.submit('ana', 'a1', pdf())).rejects.toMatchObject({ code: 'DEADLINE_PASSED' });
    expect(removed).toEqual(['k1']);
  });
  it('keeps the submission when text extraction fails (similarity becomes unavailable)', async () => {
    extractorFails = true;
    await service.submit('ana', 'a1', pdf());
    expect(outbox[0]!.text).toBeNull();
  });
  it('validates role, enrollment, assignment type, state and file', async () => {
    await expect(service.submit('teacher', 'a1', pdf())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.submit('out', 'a1', pdf())).rejects.toMatchObject({ code: 'NOT_ENROLLED' });
    await expect(service.submit('ana', 'missing', pdf())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.submit('ana', 'a1', { ...pdf(), filename: 'virus.exe' })).rejects.toMatchObject({ code: 'FILE_REJECTED' });
    await expect(service.submit('ana', 'a1', { ...pdf(), bytes: new Uint8Array() })).rejects.toMatchObject({ code: 'FILE_REJECTED' });
    await expect(service.submit('nobody', 'a1', pdf())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    assignment = { ...assignment, status: 'CLOSED' };
    await expect(service.submit('ana', 'a1', pdf())).rejects.toMatchObject({ code: 'NOT_AVAILABLE' });
    assignment = { ...assignment, status: 'PUBLISHED', type: 'QUIZ' };
    await expect(service.submit('ana', 'a1', pdf())).rejects.toMatchObject({ code: 'NOT_AN_ASSIGNMENT' });
    assignment = { ...assignment, type: 'RUBRIC', status: 'DRAFT' };
    await expect(service.submit('ana', 'a1', pdf())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    assignment = { ...assignment, status: 'PUBLISHED' }; course = { ...course, status: 'ARCHIVADO' };
    await expect(service.mine('ana', 'a1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('cleans the stored file if persisting fails', async () => {
    const failing = new SubmissionService({ find: async () => null, receive: async () => { throw new Error('db'); } } as never,
      { put: async () => ({ key: 'kx', filename: 'a.txt', mimeType: 'text/plain', size: 1, sha256: '' }), read: async () => new Uint8Array(), remove: async key => { removed.push(key); } },
      { extract: async () => null }, { find: async () => actors.ana!, names: async () => new Map() },
      { assignment: async () => assignment, course: async () => course, enrolled: async () => true, studentsOf: async () => [], scoreOf: async () => null },
      { received: async () => undefined }, { id: () => 'i' });
    await expect(failing.submit('ana', 'a1', pdf())).rejects.toThrow('db');
    expect(removed).toEqual(['kx']);
  });
  it('shows the student only their own submission and grade', async () => {
    expect((await service.mine('beto', 'a1')).submission).toBeNull();
    await expect(service.mine('teacher', 'a1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.mine('out', 'a1')).rejects.toMatchObject({ code: 'NOT_ENROLLED' });
  });
  it('lets the responsible teacher (and ADMIN read-only) list every enrolled student and download', async () => {
    await service.submit('ana', 'a1', pdf());
    const list = await service.forAssessment('teacher', 'a1');
    expect(list).toMatchObject({ canGrade: true, rows: [{ studentId: 'ana', displayName: 'ANA', score: 1650, submission: { version: 1 } }, { studentId: 'beto', submission: null }] });
    expect((await service.forAssessment('admin', 'a1')).canGrade).toBe(false);
    await expect(service.forAssessment('other', 'a1')).rejects.toBeInstanceOf(SubmissionError);
    await expect(service.forAssessment('ana', 'a1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.forAssessment('teacher', 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const fileId = list.rows[0]!.submission!.current.id;
    expect((await service.download('teacher', fileId)).filename).toBe('tarea.txt');
    expect((await service.download('ana', fileId)).bytes).toEqual(new Uint8Array([1]));
    await expect(service.download('beto', fileId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.download('teacher', 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    assignment = { ...assignment, type: 'QUIZ' };
    await expect(service.forAssessment('teacher', 'a1')).rejects.toMatchObject({ code: 'NOT_AN_ASSIGNMENT' });
  });
});
