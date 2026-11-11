import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import { createApplication } from '../dist/bootstrap.js';
import { PrismaUserRepository } from '../dist/modules/identity/infrastructure/persistence/prisma-user-repository.js';
import { ScryptPasswordHasher } from '../dist/modules/identity/infrastructure/security/scrypt-password-hasher.js';
import { User } from '../dist/modules/identity/domain/user.js';
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/edutrack_test') throw new Error('Only explicit edutrack_test DB is allowed');
const secret = randomBytes(48).toString('hex'), password = randomBytes(16).toString('hex');
const users = new PrismaUserRepository(databaseUrl, secret), db = new Pool({ connectionString: databaseUrl });
const roles = { teacher: 'TEACHER', other: 'TEACHER', designer: 'INSTRUCTIONAL_DESIGNER', ana: 'STUDENT', beto: 'STUDENT', outsider: 'STUDENT', admin: 'ADMIN' } as const;
type Name = keyof typeof roles;
let app: Awaited<ReturnType<typeof createApplication>>, folder: string, hash: string, course: any;
let actors: Record<Name, { id: string; email: string; token: string }>;
beforeAll(async () => { await mkdir(path.resolve('../../tmp'), { recursive: true }); hash = await new ScryptPasswordHasher().hash(password); });
beforeEach(async () => {
  folder = await mkdtemp(path.resolve('../../tmp/assessment-integration-')); actors = {} as typeof actors;
  for (const [name, role] of Object.entries(roles)) {
    const user = new User(randomUUID(), `${randomUUID()}@example.test`, `QA ${name}`, hash, role, new Date()); await users.create(user);
    actors[name as Name] = { id: user.id, email: user.email, token: '' };
  }
  app = await createApplication({ databaseUrl, jwtSecret: secret, port: 3000, webOrigin: 'http://localhost:5173',
    mail: { host: 'localhost', port: 1025, from: 'qa@example.test', secure: false, requireTLS: false, webOrigin: 'http://localhost:5173' }, academic: { storageRoot: path.join(folder, 'files') },
    // Seven users sign in per test: each one comes from its own client address through a trusted proxy, as behind Nginx.
    trustProxy: 'loopback' });
  await app.init();
  let address = 0;
  for (const actor of Object.values(actors)) actor.token = (await request(app.getHttpServer()).post('/api/identity/login').set('X-Forwarded-For', `198.51.100.${++address}`)
    .send({ email: actor.email, password }).expect(200)).body.accessToken;
  course = await draftCourse();
});
afterEach(async () => {
  await app?.close();
  // Assessments, grades and audit entries are immutable by design and remain in the disposable test database.
  await db.query('DELETE FROM enrollments.enrollments WHERE "courseId"=$1', [course?.id]); await db.query('DELETE FROM courses.courses WHERE id=$1', [course?.id]);
  await db.query('DELETE FROM identity.users WHERE id=ANY($1::uuid[])', [Object.values(actors).map(actor => actor.id)]); await rm(folder, { recursive: true, force: true });
});
afterAll(async () => { await users.onModuleDestroy(); await db.end(); });
function call(method: 'get' | 'post' | 'patch' | 'delete', route: string, actor: Name, body?: unknown) {
  const pending = request(app.getHttpServer())[method](`/api${route}`).auth(actors[actor].token, { type: 'bearer' }); return body === undefined ? pending : pending.send(body);
}
async function draftCourse() {
  let current = (await call('post', '/courses', 'teacher', { code: `QA-${randomUUID().slice(0, 8)}`, name: 'Evaluación QA', description: 'Curso', period: '2026-II', teacherId: actors.teacher.id }).expect(201)).body;
  current = (await call('patch', `/courses/${current.id}`, 'teacher', { code: current.code, name: current.name, description: current.description, period: current.period, teacherId: current.teacherId, syllabus: 'Sílabo', revision: current.revision }).expect(200)).body;
  current = (await call('post', `/courses/${current.id}/units`, 'teacher', { title: 'Unidad', revision: current.revision }).expect(201)).body;
  current = (await call('post', `/courses/${current.id}/units/${current.units[0].id}/sessions`, 'teacher', { title: 'Sesión', description: '', revision: current.revision }).expect(201)).body;
  return (await call('post', `/courses/${current.id}/sessions/${current.units[0].sessions[0].id}/materials`, 'teacher', { title: 'Guía', kind: 'LINK', url: 'https://example.test', revision: current.revision }).expect(201)).body;
}
async function publishCourse() {
  course = (await call('post', `/courses/${course.id}/transitions`, 'teacher', { decision: 'SUBMITTED', observations: '', revision: course.revision }).expect(201)).body;
  course = (await call('post', `/courses/${course.id}/transitions`, 'designer', { decision: 'APPROVED', observations: '', revision: course.revision }).expect(201)).body;
  await call('post', `/enrollments/courses/${course.id}/roster`, 'admin', { emails: [actors.ana.email, actors.beto.email] }).expect(200);
}
const tf = (statement: string, truth = true) => ({ type: 'TRUE_FALSE', statement, points: 2, options: [{ text: 'Verdadero', correct: truth }, { text: 'Falso', correct: !truth }] });
async function bank(questions = 3) {
  const [created] = (await call('post', `/assessments/courses/${course.id}/banks`, 'teacher', { name: `Banco ${randomUUID().slice(0, 4)}` }).expect(201)).body;
  for (let index = 0; index < questions; index++) await call('post', `/assessments/banks/${created.id}/questions`, 'teacher', tf(`Afirmación ${index}`)).expect(201);
  return created;
}
const rubricInput = { title: 'Ensayo', instructions: 'Argumenta', type: 'RUBRIC', weight: 60, dueAt: '2026-12-10T15:00:00Z',
  criteria: [{ description: 'Contenido', maxPoints: 15 }, { description: 'Forma', maxPoints: 5 }] };
async function auditOf(entityId: string) {
  return (await db.query('SELECT entity, action, before, after, "actorId" FROM audit.entries WHERE "entityId"=$1 ORDER BY id', [entityId])).rows;
}

describe('Phase 4: banks, assessments, grades and immutable audit on real PostgreSQL', () => {
  it('manages the bank, freezes the snapshot on publication and never sends answers to students', async () => {
    const created = await bank(3); await call('get', `/assessments/courses/${course.id}/banks`, 'ana').expect(403); await call('get', `/assessments/courses/${course.id}/banks`, 'other').expect(403);
    await call('post', `/assessments/banks/${created.id}/questions`, 'teacher', { ...tf('Mala'), options: [{ text: 'Verdadero', correct: true }, { text: 'Falso', correct: true }] }).expect(400);
    const quiz = (await call('post', `/assessments/courses/${course.id}`, 'teacher', { title: 'Práctica', instructions: '', type: 'QUIZ', weight: 40, dueAt: '2026-12-01T15:00:00Z', durationMinutes: 30, questionCount: 2, bankId: created.id }).expect(201)).body;
    await call('post', `/assessments/courses/${course.id}`, 'teacher', { ...rubricInput, weight: 60.01 }).expect(400);
    await call('post', `/assessments/${quiz.id}/publish`, 'teacher', { revision: 0 }).expect(409);
    expect((await call('get', `/assessments/${quiz.id}/preview`, 'teacher').expect(200)).body.questions).toHaveLength(2);
    await publishCourse();
    const published = (await call('post', `/assessments/${quiz.id}/publish`, 'teacher', { revision: 0 }).expect(200)).body; expect(published.status).toBe('PUBLISHED');
    const snapshot = (await db.query('SELECT "questionId", options FROM assessments.snapshot_questions WHERE "assessmentId"=$1', [quiz.id])).rows; expect(snapshot).toHaveLength(3);
    const [first] = (await call('get', `/assessments/courses/${course.id}/banks`, 'teacher').expect(200)).body[0].questions;
    await call('patch', `/assessments/questions/${first.id}`, 'teacher', { ...tf('Cambiada en el banco', false), version: 0 }).expect(200);
    expect((await db.query('SELECT statement FROM assessments.snapshot_questions WHERE "questionId"=$1', [first.id])).rows[0].statement).toBe('Afirmación 0');
    await expect(db.query('UPDATE assessments.snapshot_questions SET statement=$1 WHERE "assessmentId"=$2', ['x', quiz.id])).rejects.toThrow('immutable');
    await expect(db.query('DELETE FROM assessments.snapshot_questions WHERE "assessmentId"=$1', [quiz.id])).rejects.toThrow('immutable');
    const studentView = (await call('get', `/assessments/courses/${course.id}`, 'ana').expect(200)).body;
    expect(studentView).toHaveLength(1); expect(JSON.stringify(studentView)).not.toMatch(/correct|bankId|Verdadero/);
    await call('get', `/assessments/courses/${course.id}`, 'outsider').expect(403); await call('get', `/assessments/${quiz.id}/preview`, 'ana').expect(403);
  });
  it('audits publication and every change of a published assessment atomically, and rejects structural changes', async () => {
    await publishCourse();
    const rubric = (await call('post', `/assessments/courses/${course.id}`, 'teacher', rubricInput).expect(201)).body;
    await call('patch', `/assessments/${rubric.id}`, 'teacher', { ...rubricInput, title: 'Ensayo v2', revision: 0 }).expect(200);
    expect(await auditOf(rubric.id)).toEqual([]);
    await call('post', `/assessments/${rubric.id}/publish`, 'teacher', { revision: 1 }).expect(200);
    await call('patch', `/assessments/${rubric.id}`, 'teacher', { ...rubricInput, title: 'Ensayo v2', weight: 55, revision: 2 }).expect(200);
    await call('patch', `/assessments/${rubric.id}`, 'teacher', { ...rubricInput, criteria: [{ description: 'Otro', maxPoints: 20 }], revision: 3 }).expect(409);
    await call('delete', `/assessments/${rubric.id}?revision=3`, 'teacher').expect(409);
    await expect(db.query('DELETE FROM assessments.assessments WHERE id=$1', [rubric.id])).rejects.toThrow('cannot be deleted');
    const entries = await auditOf(rubric.id);
    expect(entries.map((entry: any) => [entry.entity, entry.action, entry.actorId])).toEqual([['ASSESSMENT', 'UPDATE', actors.teacher.id], ['ASSESSMENT', 'UPDATE', actors.teacher.id]]);
    expect(entries[0].before.status).toBe('DRAFT'); expect(entries[0].after.status).toBe('PUBLISHED');
    expect(entries[1].before.weightBp).toBe(6000); expect(entries[1].after.weightBp).toBe(5500);
    await expect(db.query('UPDATE assessments.assessments SET title=$1 WHERE id=$2', ['Sin actor', rubric.id])).rejects.toThrow('requires an actor');
  });
  it('grades with the rubric strategy, versions changes with reasons, audits each change and computes weighted averages', async () => {
    await publishCourse(); const rubric = (await call('post', `/assessments/courses/${course.id}`, 'teacher', rubricInput).expect(201)).body;
    const route = `/grading/assessments/${rubric.id}/students/${actors.ana.id}`;
    await call('post', route, 'teacher', { awards: [{ criterionId: rubric.criteria[0].id, points: 15 }, { criterionId: rubric.criteria[1].id, points: 5 }] }).expect(409);
    await call('post', `/assessments/${rubric.id}/publish`, 'teacher', { revision: 0 }).expect(200);
    const awards = (content: number, form: number) => [{ criterionId: rubric.criteria[0].id, points: content }, { criterionId: rubric.criteria[1].id, points: form }];
    expect((await call('post', route, 'teacher', { awards: awards(12, 4.5) }).expect(200)).body).toMatchObject({ score: 16.5, version: 0, origin: 'RUBRIC' });
    await call('post', route, 'other', { awards: awards(1, 1) }).expect(403); await call('post', route, 'admin', { awards: awards(1, 1) }).expect(403);
    await call('post', `/grading/assessments/${rubric.id}/students/${actors.outsider.id}`, 'teacher', { awards: awards(1, 1) }).expect(400);
    await call('post', route, 'teacher', { awards: awards(16, 1) }).expect(400);
    await call('post', route, 'teacher', { awards: awards(10, 1), version: 0 }).expect(400);
    const changed = (await call('post', route, 'teacher', { awards: awards(10, 1), version: 0, reason: 'Reclamo atendido' }).expect(200)).body; expect(changed).toMatchObject({ score: 11, version: 1 });
    await call('post', route, 'teacher', { awards: awards(9, 1), version: 0, reason: 'Obsoleta' }).expect(409);
    const grade = (await db.query('SELECT id FROM grading.grades WHERE "assessmentId"=$1 AND "studentId"=$2', [rubric.id, actors.ana.id])).rows[0];
    const entries = await auditOf(grade.id);
    expect(entries.map((entry: any) => [entry.entity, entry.action])).toEqual([['GRADE', 'INSERT'], ['GRADE', 'UPDATE']]);
    expect(entries[1].before.scoreCents).toBe(1650); expect(entries[1].after).toMatchObject({ scoreCents: 1100, reason: 'Reclamo atendido' }); expect(entries[1].actorId).toBe(actors.teacher.id);
    await expect(db.query('DELETE FROM grading.grades WHERE id=$1', [grade.id])).rejects.toThrow('cannot be deleted');
    await expect(db.query('UPDATE grading.grades SET "scoreCents"=2000 WHERE id=$1', [grade.id])).rejects.toThrow('requires an actor');
    const book = (await call('get', `/grading/courses/${course.id}/gradebook`, 'teacher').expect(200)).body;
    const ana = book.students.find((student: any) => student.studentId === actors.ana.id);
    expect(ana.average).toMatchObject({ current: 11, final: 6.6, finalRounded: 7, approved: false, totalWeight: 60 });
    expect(book.students.map((student: any) => student.studentId).sort()).toEqual([actors.ana.id, actors.beto.id].sort());
    expect((await call('get', `/grading/courses/${course.id}/gradebook`, 'admin').expect(200)).body.canGrade).toBe(false);
    await call('get', `/grading/courses/${course.id}/gradebook`, 'other').expect(403); await call('get', `/grading/courses/${course.id}/gradebook`, 'ana').expect(403);
    const mine = (await call('get', `/grading/courses/${course.id}/me`, 'ana').expect(200)).body;
    expect(mine.grades).toEqual([expect.objectContaining({ score: 11 })]); expect(mine.grades[0]).not.toHaveProperty('reason');
    expect((await call('get', `/grading/courses/${course.id}/me`, 'beto').expect(200)).body.grades).toEqual([]);
    await call('get', `/grading/courses/${course.id}/me`, 'outsider').expect(403);
  });
  it('exposes the audit log and chain verification only to administrators and detects tampering', async () => {
    await publishCourse(); const rubric = (await call('post', `/assessments/courses/${course.id}`, 'teacher', rubricInput).expect(201)).body;
    await call('post', `/assessments/${rubric.id}/publish`, 'teacher', { revision: 0 }).expect(200);
    const listed = (await call('get', `/audit/entries?entity=ASSESSMENT&entityId=${rubric.id}`, 'admin').expect(200)).body;
    expect(listed).toHaveLength(1); expect(listed[0]).toMatchObject({ actorName: 'QA teacher', changes: expect.arrayContaining([{ field: 'status', before: 'DRAFT', after: 'PUBLISHED' }]) });
    await call('get', '/audit/entries', 'teacher').expect(403); await call('get', '/audit/verify', 'ana').expect(403); await call('get', '/audit/entries?entity=USER', 'admin').expect(400);
    expect((await call('get', '/audit/verify', 'admin').expect(200)).body).toMatchObject({ valid: true, firstInvalidId: null });
    const [row] = (await db.query('SELECT id, after FROM audit.entries WHERE "entityId"=$1', [rubric.id])).rows;
    await expect(db.query('UPDATE audit.entries SET after=$1 WHERE id=$2', [{}, row.id])).rejects.toThrow('immutable');
    await expect(db.query('DELETE FROM audit.entries WHERE id=$1', [row.id])).rejects.toThrow('immutable');
    await expect(db.query('TRUNCATE audit.entries')).rejects.toThrow('immutable');
    // Simulates a privileged attacker who disables the trigger: the hash chain still exposes the alteration.
    const client = await db.connect();
    try {
      await client.query('ALTER TABLE audit.entries DISABLE TRIGGER entries_immutable');
      await client.query(`UPDATE audit.entries SET after = jsonb_set(after, '{weightBp}', '10000') WHERE id=$1`, [row.id]);
      expect((await call('get', '/audit/verify', 'admin').expect(200)).body).toMatchObject({ valid: false, firstInvalidId: String(row.id) });
      await client.query('UPDATE audit.entries SET after=$1 WHERE id=$2', [row.after, row.id]);
    } finally { await client.query('ALTER TABLE audit.entries ENABLE TRIGGER entries_immutable'); client.release(); }
    expect((await call('get', '/audit/verify', 'admin').expect(200)).body.valid).toBe(true);
  });
});
