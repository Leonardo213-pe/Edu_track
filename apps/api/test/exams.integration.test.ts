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
const roles = { teacher: 'TEACHER', designer: 'INSTRUCTIONAL_DESIGNER', ana: 'STUDENT', beto: 'STUDENT', outsider: 'STUDENT', admin: 'ADMIN' } as const;
type Name = keyof typeof roles;
const SYSTEM = '00000000-0000-4000-8000-000000000000';
let app: Awaited<ReturnType<typeof createApplication>>, folder: string, hash: string, course: any, quiz: any, key: Map<string, string>;
let actors: Record<Name, { id: string; email: string; token: string }>;
const config = () => ({ databaseUrl: databaseUrl!, jwtSecret: secret, port: 3000, webOrigin: 'http://localhost:5173', trustProxy: 'loopback', examJobIntervalMs: 200,
  mail: { host: 'localhost', port: 1025, from: 'qa@example.test', secure: false, requireTLS: false, webOrigin: 'http://localhost:5173' }, academic: { storageRoot: path.join(folder, 'files') } });
beforeAll(async () => { await mkdir(path.resolve('../../tmp'), { recursive: true }); hash = await new ScryptPasswordHasher().hash(password); });
beforeEach(async () => {
  folder = await mkdtemp(path.resolve('../../tmp/exam-integration-')); actors = {} as typeof actors;
  for (const [name, role] of Object.entries(roles)) {
    const user = new User(randomUUID(), `${randomUUID()}@example.test`, `QA ${name}`, hash, role, new Date()); await users.create(user);
    actors[name as Name] = { id: user.id, email: user.email, token: '' };
  }
  app = await createApplication(config()); await app.init();
  let address = 0;
  for (const actor of Object.values(actors)) actor.token = (await request(app.getHttpServer()).post('/api/identity/login').set('X-Forwarded-For', `198.51.100.${++address}`)
    .send({ email: actor.email, password }).expect(200)).body.accessToken;
  await publishedQuiz();
});
afterEach(async () => {
  await app?.close();
  // Attempts, answers, grades and audit are immutable by design and stay in the disposable test database.
  await db.query('DELETE FROM enrollments.enrollments WHERE "courseId"=$1', [course?.id]); await db.query('DELETE FROM courses.courses WHERE id=$1', [course?.id]);
  await db.query('DELETE FROM identity.users WHERE id=ANY($1::uuid[])', [Object.values(actors).map(actor => actor.id)]); await rm(folder, { recursive: true, force: true });
});
afterAll(async () => { await users.onModuleDestroy(); await db.end(); });
function call(method: 'get' | 'post' | 'put' | 'patch', route: string, actor: Name, body?: unknown) {
  const pending = request(app.getHttpServer())[method](`/api${route}`).auth(actors[actor].token, { type: 'bearer' }); return body === undefined ? pending : pending.send(body);
}
async function publishedQuiz() {
  let current = (await call('post', '/courses', 'teacher', { code: `EX-${randomUUID().slice(0, 8)}`, name: 'Examen QA', description: 'Curso', period: '2026-II', teacherId: actors.teacher.id }).expect(201)).body;
  current = (await call('patch', `/courses/${current.id}`, 'teacher', { code: current.code, name: current.name, description: current.description, period: current.period, teacherId: current.teacherId, syllabus: 'Sílabo', revision: current.revision }).expect(200)).body;
  current = (await call('post', `/courses/${current.id}/units`, 'teacher', { title: 'Unidad', revision: current.revision }).expect(201)).body;
  current = (await call('post', `/courses/${current.id}/units/${current.units[0].id}/sessions`, 'teacher', { title: 'Sesión', description: '', revision: current.revision }).expect(201)).body;
  current = (await call('post', `/courses/${current.id}/sessions/${current.units[0].sessions[0].id}/materials`, 'teacher', { title: 'Guía', kind: 'LINK', url: 'https://example.test', revision: current.revision }).expect(201)).body;
  current = (await call('post', `/courses/${current.id}/transitions`, 'teacher', { decision: 'SUBMITTED', observations: '', revision: current.revision }).expect(201)).body;
  course = (await call('post', `/courses/${current.id}/transitions`, 'designer', { decision: 'APPROVED', observations: '', revision: current.revision }).expect(201)).body;
  await call('post', `/enrollments/courses/${course.id}/roster`, 'admin', { emails: [actors.ana.email, actors.beto.email] }).expect(200);
  const [bank] = (await call('post', `/assessments/courses/${course.id}/banks`, 'teacher', { name: 'Banco examen' }).expect(201)).body;
  for (let index = 0; index < 3; index++) await call('post', `/assessments/banks/${bank.id}/questions`, 'teacher',
    { type: 'TRUE_FALSE', statement: `Afirmación ${index}`, points: 2, options: [{ text: 'Verdadero', correct: true }, { text: 'Falso', correct: false }] }).expect(201);
  key = new Map((await call('get', `/assessments/courses/${course.id}/banks`, 'teacher').expect(200)).body[0].questions
    .map((question: any) => [question.id, question.options.find((option: any) => option.correct).id]));
  quiz = (await call('post', `/assessments/courses/${course.id}`, 'teacher', { title: 'Práctica', instructions: '', type: 'QUIZ', weight: 40, dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    durationMinutes: 30, questionCount: 2, bankId: bank.id }).expect(201)).body;
  quiz = (await call('post', `/assessments/${quiz.id}/publish`, 'teacher', { revision: 0 }).expect(200)).body;
}
const wrong = (questionId: string, attempt: any) => attempt.questions.find((q: any) => q.questionId === questionId).options.find((o: any) => o.id !== key.get(questionId)).id;
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, timeout = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) { const value = await read(); if (done(value)) return value; if (Date.now() - start > timeout) return value; await new Promise(resolve => setTimeout(resolve, 150)); }
}

describe('Phase 5: timed attempts, durable autosave and automatic grading on real PostgreSQL', () => {
  it('starts one attempt per student, even concurrently, drawing questions without answers', async () => {
    await call('get', `/exams/assessments/${quiz.id}/attempt`, 'outsider').expect(403); await call('post', `/exams/assessments/${quiz.id}/attempt`, 'teacher').expect(403);
    expect((await call('get', `/exams/assessments/${quiz.id}/attempt`, 'ana').expect(200)).body).toMatchObject({ canStart: true, attempt: null });
    const started = await Promise.all([1, 2, 3].map(() => call('post', `/exams/assessments/${quiz.id}/attempt`, 'ana').expect(200)));
    expect(new Set(started.map(response => response.body.id)).size).toBe(1);
    const attempt = started[0]!.body; expect(attempt.questions).toHaveLength(2); expect(JSON.stringify(attempt)).not.toMatch(/correct/);
    expect(attempt.remainingSeconds).toBeGreaterThan(1790); expect(new Date(attempt.expiresAt).getTime() - new Date(attempt.startedAt).getTime()).toBe(30 * 60_000);
    expect((await db.query('SELECT count(*) FROM exams.attempts WHERE "assessmentId"=$1 AND "studentId"=$2', [quiz.id, actors.ana.id])).rows[0].count).toBe('1');
    await call('get', `/exams/attempts/${attempt.id}`, 'beto').expect(403);
  });
  it('acknowledges only durable, monotonic versions: duplicates and reordered retries never overwrite newer answers', async () => {
    const attempt = (await call('post', `/exams/assessments/${quiz.id}/attempt`, 'ana').expect(200)).body; const [q1, q2] = attempt.questions;
    const save = (question: any, optionIds: string[], version: number, actor: Name = 'ana') => call('put', `/exams/attempts/${attempt.id}/answers/${question.questionId}`, actor, { optionIds, version });
    expect((await save(q1, [wrong(q1.questionId, attempt)], 1).expect(200)).body).toMatchObject({ accepted: true, version: 1 });
    expect((await save(q1, [key.get(q1.questionId)!], 3).expect(200)).body).toMatchObject({ accepted: true, version: 3 });
    const late = (await save(q1, [wrong(q1.questionId, attempt)], 2).expect(200)).body; expect(late).toMatchObject({ accepted: false, version: 3, optionIds: [key.get(q1.questionId)] });
    expect((await save(q1, [key.get(q1.questionId)!], 3).expect(200)).body).toMatchObject({ accepted: false, version: 3 });
    // A burst of out-of-order retries: the stored answer is always the one with the greatest version.
    const burst = await Promise.all(Array.from({ length: 20 }, (_, index) => save(q2, [index % 2 ? key.get(q2.questionId)! : wrong(q2.questionId, attempt)], 4 + index)));
    expect(burst.every(response => response.status === 200)).toBe(true);
    const row = (await db.query('SELECT version, "optionIds" FROM exams.answers WHERE "attemptId"=$1 AND "questionId"=$2', [attempt.id, q2.questionId])).rows[0];
    expect(Number(row.version)).toBe(23); expect(row.optionIds).toEqual([key.get(q2.questionId)]);
    await save(q1, ['not-an-option'], 9).expect(400); await save(q1, [key.get(q1.questionId)!], 0).expect(400); await save(q1, [key.get(q1.questionId)!], 9, 'beto').expect(403);
    await call('put', `/exams/attempts/${attempt.id}/answers/${randomUUID()}`, 'ana', { optionIds: [], version: 1 }).expect(404);
  });
  it('keeps every acknowledged answer across an API restart and lets the student continue (EAC-02/03)', async () => {
    const attempt = (await call('post', `/exams/assessments/${quiz.id}/attempt`, 'ana').expect(200)).body; const [q1, q2] = attempt.questions;
    await call('put', `/exams/attempts/${attempt.id}/answers/${q1.questionId}`, 'ana', { optionIds: [key.get(q1.questionId)], version: 5 }).expect(200);
    await app.close(); app = await createApplication(config()); await app.init(); // simulates the loss and replacement of the instance
    const resumed = (await call('get', `/exams/attempts/${attempt.id}`, 'ana').expect(200)).body;
    expect(resumed.answers).toEqual([{ questionId: q1.questionId, optionIds: [key.get(q1.questionId)], version: 5 }]); expect(resumed.status).toBe('IN_PROGRESS');
    expect(new Date(resumed.expiresAt).toISOString()).toBe(new Date(attempt.expiresAt).toISOString()); // no extra time after reconnecting
    await call('put', `/exams/attempts/${attempt.id}/answers/${q2.questionId}`, 'ana', { optionIds: [wrong(q2.questionId, attempt)], version: 1 }).expect(200);
  });
  it('finalizes atomically with an outbox event that the in-process consumer grades automatically and audits as the system', async () => {
    const attempt = (await call('post', `/exams/assessments/${quiz.id}/attempt`, 'ana').expect(200)).body; const [q1, q2] = attempt.questions;
    await call('put', `/exams/attempts/${attempt.id}/answers/${q1.questionId}`, 'ana', { optionIds: [key.get(q1.questionId)], version: 1 }).expect(200);
    await call('put', `/exams/attempts/${attempt.id}/answers/${q2.questionId}`, 'ana', { optionIds: [wrong(q2.questionId, attempt)], version: 1 }).expect(200);
    const done = (await call('post', `/exams/attempts/${attempt.id}/finalize`, 'ana').expect(200)).body; expect(done).toMatchObject({ status: 'SUBMITTED', finalizedBy: 'STUDENT' });
    await call('post', `/exams/attempts/${attempt.id}/finalize`, 'ana').expect(200);
    const events = (await db.query('SELECT type, payload FROM exams.outbox WHERE "aggregateId"=$1', [attempt.id])).rows;
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ type: 'AttemptFinalized.v1', payload: { attemptId: attempt.id, schemaVersion: 1, reason: 'STUDENT' } });
    await call('put', `/exams/attempts/${attempt.id}/answers/${q1.questionId}`, 'ana', { optionIds: [], version: 99 }).expect(409);
    await expect(db.query('UPDATE exams.answers SET version=100 WHERE "attemptId"=$1', [attempt.id])).rejects.toThrow('Attempt is closed');
    await expect(db.query('UPDATE exams.attempts SET status=$1 WHERE id=$2', ['IN_PROGRESS', attempt.id])).rejects.toThrow('immutable');
    await expect(db.query('DELETE FROM exams.attempts WHERE id=$1', [attempt.id])).rejects.toThrow('cannot be deleted');
    const mine = await eventually(async () => (await call('get', `/grading/courses/${course.id}/me`, 'ana').expect(200)).body, body => body.grades.length > 0);
    expect(mine.grades).toEqual([expect.objectContaining({ assessmentId: quiz.id, score: 10, origin: 'AUTOMATIC' })]); expect(mine.average).toMatchObject({ final: 4, gradedWeight: 40 });
    expect((await call('get', `/exams/attempts/${attempt.id}`, 'ana').expect(200)).body.score).toBe(10);
    const grade = (await db.query('SELECT id FROM grading.grades WHERE "assessmentId"=$1 AND "studentId"=$2', [quiz.id, actors.ana.id])).rows[0];
    expect((await db.query('SELECT action, "actorId" FROM audit.entries WHERE "entityId"=$1', [grade.id])).rows).toEqual([{ action: 'INSERT', actorId: SYSTEM }]);
    expect((await db.query('SELECT "processedAt" IS NOT NULL AS done FROM exams.outbox WHERE "aggregateId"=$1', [attempt.id])).rows[0].done).toBe(true);
    const list = (await call('get', `/exams/assessments/${quiz.id}/attempts`, 'teacher').expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ studentId: actors.ana.id, status: 'SUBMITTED', answered: 2, score: 10 })]);
    await call('get', `/exams/assessments/${quiz.id}/attempts`, 'ana').expect(403);
    expect((await call('get', '/audit/entries?entity=GRADE', 'admin').expect(200)).body.find((entry: any) => entry.entityId === grade.id).actorName).toBe('Sistema (calificación automática)');
  });
  it('closes expired attempts by the database clock: no extra time, sweeper finalizes and grades what was saved (A2)', async () => {
    const attempt = (await call('post', `/exams/assessments/${quiz.id}/attempt`, 'beto').expect(200)).body; const [q1] = attempt.questions;
    await call('put', `/exams/attempts/${attempt.id}/answers/${q1.questionId}`, 'beto', { optionIds: [key.get(q1.questionId)], version: 1 }).expect(200);
    const client = await db.connect();
    try { // test-only shortcut to reach the deadline: bypass the immutability trigger in this session
      await client.query("SET session_replication_role = replica");
      await client.query(`UPDATE exams.attempts SET "expiresAt" = clock_timestamp() - interval '1 second', "startedAt" = clock_timestamp() - interval '31 minutes' WHERE id=$1`, [attempt.id]);
    } finally { await client.query('SET session_replication_role = origin'); client.release(); }
    await call('put', `/exams/attempts/${attempt.id}/answers/${q1.questionId}`, 'beto', { optionIds: [], version: 2 }).expect(409);
    const closed = await eventually(async () => (await db.query('SELECT status, "finalizedBy" FROM exams.attempts WHERE id=$1', [attempt.id])).rows[0], row => row.status !== 'IN_PROGRESS');
    expect(closed).toEqual({ status: 'EXPIRED', finalizedBy: 'TIMEOUT' });
    const mine = await eventually(async () => (await call('get', `/grading/courses/${course.id}/me`, 'beto').expect(200)).body, body => body.grades.length > 0);
    expect(mine.grades[0]).toMatchObject({ score: 10, origin: 'AUTOMATIC' });
    expect((await call('get', `/exams/assessments/${quiz.id}/attempt`, 'beto').expect(200)).body).toMatchObject({ canStart: false, attempt: { status: 'EXPIRED' }, score: 10 });
  });
  it('serves parallel autosaves of different students without errors (no shared lock)', async () => {
    const [ana, beto] = await Promise.all([call('post', `/exams/assessments/${quiz.id}/attempt`, 'ana').expect(200), call('post', `/exams/assessments/${quiz.id}/attempt`, 'beto').expect(200)]);
    const requests = [ana.body, beto.body].flatMap(attempt => Array.from({ length: 25 }, (_, index) => {
      const question = attempt.questions[index % 2]; const owner: Name = attempt.id === ana.body.id ? 'ana' : 'beto';
      return call('put', `/exams/attempts/${attempt.id}/answers/${question.questionId}`, owner, { optionIds: [key.get(question.questionId)], version: index + 1 });
    }));
    const started = Date.now(); const responses = await Promise.all(requests);
    expect(responses.every(response => response.status === 200)).toBe(true); expect(Date.now() - started).toBeLessThan(10_000);
    expect((await db.query('SELECT count(*) FROM exams.answers WHERE "attemptId"=ANY($1::uuid[])', [[ana.body.id, beto.body.id]])).rows[0].count).toBe('4');
  });
});
