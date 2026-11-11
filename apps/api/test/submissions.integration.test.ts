import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import { createApplication } from '../dist/bootstrap.js';
import { PrismaUserRepository } from '../dist/modules/identity/infrastructure/persistence/prisma-user-repository.js';
import { ScryptPasswordHasher } from '../dist/modules/identity/infrastructure/security/scrypt-password-hasher.js';
import { User } from '../dist/modules/identity/domain/user.js';

// Real PostgreSQL, real files on disk, the in-process outbox consumer and the SIMULATED plagiarism provider.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/edutrack_test') throw new Error('Only explicit edutrack_test DB is allowed');
const secret = randomBytes(48).toString('hex'), password = randomBytes(16).toString('hex');
const users = new PrismaUserRepository(databaseUrl, secret), db = new Pool({ connectionString: databaseUrl });
const roles = { teacher: 'TEACHER', other: 'TEACHER', designer: 'INSTRUCTIONAL_DESIGNER', ana: 'STUDENT', beto: 'STUDENT', outsider: 'STUDENT', admin: 'ADMIN' } as const;
type Name = keyof typeof roles;
let app: Awaited<ReturnType<typeof createApplication>>, folder: string, hash: string, course: any;
let actors: Record<Name, { id: string; email: string; token: string }>;
const essay = 'La fotosíntesis es el proceso mediante el cual las plantas verdes convierten la energía luminosa en energía química almacenada en la glucosa dentro de los cloroplastos';
const copied = `Introducción. ${essay}. Conclusión propia del estudiante.`;
const different = 'El ciclo del agua describe la evaporación del océano, la condensación en nubes y la precipitación que alimenta ríos y acuíferos durante todo el año';

beforeAll(async () => { await mkdir(path.resolve('../../tmp'), { recursive: true }); hash = await new ScryptPasswordHasher().hash(password); });
beforeEach(async () => {
  folder = await mkdtemp(path.resolve('../../tmp/submissions-integration-')); actors = {} as typeof actors;
  for (const [name, role] of Object.entries(roles)) {
    const user = new User(randomUUID(), `${randomUUID()}@example.test`, `QA ${name}`, hash, role, new Date()); await users.create(user);
    actors[name as Name] = { id: user.id, email: user.email, token: '' };
  }
  app = await createApplication({ databaseUrl: databaseUrl!, jwtSecret: secret, port: 3000, webOrigin: 'http://localhost:5173', trustProxy: 'loopback', examJobIntervalMs: 200,
    mail: { host: 'localhost', port: 1025, from: 'qa@example.test', secure: false, requireTLS: false, webOrigin: 'http://localhost:5173' },
    academic: { storageRoot: path.join(folder, 'files'), submissionStorageRoot: path.join(folder, 'submissions') } });
  await app.init();
  let address = 0;
  for (const actor of Object.values(actors)) actor.token = (await request(app.getHttpServer()).post('/api/identity/login').set('X-Forwarded-For', `192.0.2.${++address}`)
    .send({ email: actor.email, password }).expect(200)).body.accessToken;
  await publishedCourse();
});
afterEach(async () => {
  await app?.close();
  await db.query('DELETE FROM enrollments.enrollments WHERE "courseId"=$1', [course?.id]); await db.query('DELETE FROM enrollments.sections WHERE "courseId"=$1', [course?.id]);
  await db.query('DELETE FROM courses.courses WHERE id=$1', [course?.id]);
  await db.query('DELETE FROM collaboration.notifications WHERE "userId"=ANY($1::uuid[])', [Object.values(actors).map(actor => actor.id)]);
  await db.query('DELETE FROM identity.users WHERE id=ANY($1::uuid[])', [Object.values(actors).map(actor => actor.id)]); await rm(folder, { recursive: true, force: true });
});
afterAll(async () => { await users.onModuleDestroy(); await db.end(); });
function call(method: 'get' | 'post' | 'patch', route: string, actor: Name, body?: unknown) {
  const pending = request(app.getHttpServer())[method](`/api${route}`).auth(actors[actor].token, { type: 'bearer' });
  return body === undefined ? pending : pending.send(body);
}
const upload = (assessmentId: string, actor: Name, text: string, filename = 'tarea.txt', type = 'text/plain') =>
  request(app.getHttpServer()).post(`/api/submissions/assessments/${assessmentId}`).auth(actors[actor].token, { type: 'bearer' })
    .attach('file', Buffer.from(text), { filename, contentType: type });
async function publishedCourse() {
  let current = (await call('post', '/courses', 'teacher', { code: `SB-${randomUUID().slice(0, 8)}`, name: 'Tareas QA', description: 'Curso', period: '2026-II', teacherId: actors.teacher.id }).expect(201)).body;
  current = (await call('patch', `/courses/${current.id}`, 'teacher', { code: current.code, name: current.name, description: current.description, period: current.period, teacherId: current.teacherId, syllabus: 'Sílabo', revision: current.revision }).expect(200)).body;
  current = (await call('post', `/courses/${current.id}/units`, 'teacher', { title: 'Unidad 1', revision: current.revision }).expect(201)).body;
  current = (await call('post', `/courses/${current.id}/units/${current.units[0].id}/sessions`, 'teacher', { title: 'Sesión', description: '', revision: current.revision }).expect(201)).body;
  current = (await call('post', `/courses/${current.id}/sessions/${current.units[0].sessions[0].id}/materials`, 'teacher', { title: 'Guía', kind: 'LINK', url: 'https://example.test', revision: current.revision }).expect(201)).body;
  current = (await call('post', `/courses/${current.id}/transitions`, 'teacher', { decision: 'SUBMITTED', observations: '', revision: current.revision }).expect(201)).body;
  course = (await call('post', `/courses/${current.id}/transitions`, 'designer', { decision: 'APPROVED', observations: '', revision: current.revision }).expect(201)).body;
  await call('post', `/enrollments/courses/${course.id}/roster`, 'admin', { emails: [actors.ana.email, actors.beto.email] }).expect(200);
}
async function assignment(dueInMs = 24 * 3_600_000) {
  const created = (await call('post', `/assessments/courses/${course.id}`, 'teacher', { title: 'Ensayo', instructions: 'Entrega un archivo', type: 'RUBRIC', weight: 20,
    dueAt: new Date(Date.now() + dueInMs).toISOString(), criteria: [{ description: 'Contenido', maxPoints: 15 }, { description: 'Forma', maxPoints: 5 }] }).expect(201)).body;
  return (await call('post', `/assessments/${created.id}/publish`, 'teacher', { revision: 0 }).expect(200)).body;
}
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, timeout = 10000): Promise<T> {
  const start = Date.now(); for (;;) { const value = await read(); if (done(value) || Date.now() - start > timeout) return value; await new Promise(resolve => setTimeout(resolve, 150)); }
}

describe('assignment submissions and SIMULATED plagiarism check', () => {
  it('stores versions with their event atomically, reports similarity asynchronously and lets the teacher grade with the rubric', async () => {
    const task = await assignment();
    await upload(task.id, 'beto', essay).expect(201);
    const first = (await upload(task.id, 'ana', different).expect(201)).body;
    expect(first.submission).toMatchObject({ version: 1, current: { filename: 'tarea.txt', mimeType: 'text/plain' } });
    const second = (await upload(task.id, 'ana', copied).expect(201)).body;
    expect(second.submission).toMatchObject({ version: 2 }); expect(second.submission.history).toHaveLength(2);
    // Each version and its SubmissionReceived.v1 event were committed together.
    const events = (await db.query(`SELECT payload->>'version' AS version FROM submissions.outbox WHERE "aggregateId"=$1 ORDER BY "createdAt"`, [second.submission.id])).rows;
    expect(events).toEqual([{ version: '1' }, { version: '2' }]);
    expect((await readdir(path.join(folder, 'submissions'))).length).toBe(3);
    // Asynchronous consumer: one report per file, with the copy detected against beto's essay.
    const reports = await eventually(async () => (await call('get', `/plagiarism/assessments/${task.id}`, 'teacher').expect(200)).body, body => body.reports.length >= 3);
    expect(reports).toMatchObject({ provider: 'SIMULADO-NGRAM-v1', simulated: true });
    const current = reports.reports.find((report: any) => report.fileId === second.submission.current.id);
    expect(current.status).toBe('COMPLETED'); expect(current.similarity).toBeGreaterThan(70);
    expect(current.matches[0]).toMatchObject({ studentId: actors.beto.id, displayName: 'QA beto' });
    expect(reports.reports.find((report: any) => report.fileId === first.submission.current.id).similarity).toBeLessThan(20);
    expect(Number((await db.query('SELECT count(*) FROM plagiarism.reports WHERE "assessmentId"=$1', [task.id])).rows[0].count)).toBe(3);
    expect((await db.query('SELECT count(*)::int AS pending FROM submissions.outbox WHERE "aggregateId"=$1 AND "processedAt" IS NULL', [second.submission.id])).rows[0].pending).toBe(0);
    // Teacher: list, download and grade with the rubric; student: status and grade.
    const list = (await call('get', `/submissions/assessments/${task.id}`, 'teacher').expect(200)).body;
    expect(list.canGrade).toBe(true); expect(list.rows.map((row: any) => row.displayName).sort()).toEqual(['QA ana', 'QA beto']);
    const file = await call('get', `/submissions/files/${second.submission.current.id}`, 'teacher').expect(200);
    expect(file.headers['content-disposition']).toContain('tarea.txt'); expect(file.text).toContain('Conclusión propia');
    await call('post', `/grading/assessments/${task.id}/students/${actors.ana.id}`, 'teacher', { awards: [{ criterionId: task.criteria[0].id, points: 12 }, { criterionId: task.criteria[1].id, points: 4 }] }).expect(200);
    expect((await call('get', `/submissions/assessments/${task.id}/me`, 'ana').expect(200)).body).toMatchObject({ score: 1600, submission: { version: 2 } });
    const receipts = (await db.query(`SELECT title FROM collaboration.notifications WHERE "userId"=$1 AND type='SUBMISSION'`, [actors.ana.id])).rows;
    expect(receipts).toHaveLength(2);
  });
  it('enforces enrollment, role, file type and the database deadline', async () => {
    const task = await assignment();
    await upload(task.id, 'outsider', essay).expect(403);
    await upload(task.id, 'teacher', essay).expect(403);
    await upload(task.id, 'ana', 'MZ\u0000binary', 'virus.exe', 'application/octet-stream').expect(400);
    await upload(task.id, 'ana', 'no es pdf', 'falso.pdf', 'application/pdf').expect(400);
    await call('get', `/submissions/assessments/${task.id}`, 'other').expect(403);
    await call('get', `/plagiarism/assessments/${task.id}`, 'ana').expect(403);
    await call('get', `/submissions/assessments/${task.id}`, 'admin').expect(200);
    const sent = (await upload(task.id, 'ana', essay).expect(201)).body;
    await call('get', `/submissions/files/${sent.submission.current.id}`, 'beto').expect(403);
    await expect(db.query(`UPDATE submissions.files SET filename='x' WHERE id=$1`, [sent.submission.current.id])).rejects.toThrow(/immutable/);
    await expect(db.query('DELETE FROM submissions.submissions WHERE id=$1', [sent.submission.id])).rejects.toThrow(/cannot be deleted/);
    const soon = await assignment(2500);
    await new Promise(resolve => setTimeout(resolve, 3000));
    expect((await upload(soon.id, 'ana', essay).expect(409)).body.code).toBe('DEADLINE_PASSED');
  });
});
