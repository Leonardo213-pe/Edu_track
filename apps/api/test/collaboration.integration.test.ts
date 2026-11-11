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
let app: Awaited<ReturnType<typeof createApplication>>, folder: string, hash: string, course: any;
let actors: Record<Name, { id: string; email: string; token: string }>;
beforeAll(async () => { await mkdir(path.resolve('../../tmp'), { recursive: true }); hash = await new ScryptPasswordHasher().hash(password); });
beforeEach(async () => {
  folder = await mkdtemp(path.resolve('../../tmp/collab-integration-')); actors = {} as typeof actors;
  for (const [name, role] of Object.entries(roles)) {
    const user = new User(randomUUID(), `${randomUUID()}@example.test`, `QA ${name}`, hash, role, new Date()); await users.create(user);
    actors[name as Name] = { id: user.id, email: user.email, token: '' };
  }
  app = await createApplication({ databaseUrl: databaseUrl!, jwtSecret: secret, port: 3000, webOrigin: 'http://localhost:5173', trustProxy: 'loopback', reminderIntervalMs: 300,
    mail: { host: 'localhost', port: 1025, from: 'qa@example.test', secure: false, requireTLS: false, webOrigin: 'http://localhost:5173' }, academic: { storageRoot: path.join(folder, 'files') } });
  await app.init();
  let address = 0;
  for (const actor of Object.values(actors)) actor.token = (await request(app.getHttpServer()).post('/api/identity/login').set('X-Forwarded-For', `203.0.113.${++address}`)
    .send({ email: actor.email, password }).expect(200)).body.accessToken;
  await publishedCourse();
});
afterEach(async () => {
  await app?.close();
  await db.query('DELETE FROM enrollments.enrollments WHERE "courseId"=$1', [course?.id]); await db.query('DELETE FROM collaboration.forums WHERE "courseId"=$1', [course?.id]);
  await db.query('DELETE FROM courses.courses WHERE id=$1', [course?.id]);
  await db.query('DELETE FROM identity.users WHERE id=ANY($1::uuid[])', [Object.values(actors).map(actor => actor.id)]); await rm(folder, { recursive: true, force: true });
});
afterAll(async () => { await users.onModuleDestroy(); await db.end(); });
function call(method: 'get' | 'post' | 'put' | 'patch' | 'delete', route: string, actor: Name, body?: unknown, from?: string) {
  let pending = request(app.getHttpServer())[method](`/api${route}`).auth(actors[actor].token, { type: 'bearer' }); if (from) pending = pending.set('X-Forwarded-For', from);
  return body === undefined ? pending : pending.send(body);
}
async function publishedCourse() {
  let current = (await call('post', '/courses', 'teacher', { code: `CO-${randomUUID().slice(0, 8)}`, name: 'Foros QA', description: 'Curso', period: '2026-II', teacherId: actors.teacher.id }).expect(201)).body;
  current = (await call('patch', `/courses/${current.id}`, 'teacher', { code: current.code, name: current.name, description: current.description, period: current.period, teacherId: current.teacherId, syllabus: 'Sílabo', revision: current.revision }).expect(200)).body;
  current = (await call('post', `/courses/${current.id}/units`, 'teacher', { title: 'Unidad 1', revision: current.revision }).expect(201)).body;
  current = (await call('post', `/courses/${current.id}/units/${current.units[0].id}/sessions`, 'teacher', { title: 'Sesión', description: '', revision: current.revision }).expect(201)).body;
  current = (await call('post', `/courses/${current.id}/sessions/${current.units[0].sessions[0].id}/materials`, 'teacher', { title: 'Guía', kind: 'LINK', url: 'https://example.test', revision: current.revision }).expect(201)).body;
  current = (await call('post', `/courses/${current.id}/transitions`, 'teacher', { decision: 'SUBMITTED', observations: '', revision: current.revision }).expect(201)).body;
  course = (await call('post', `/courses/${current.id}/transitions`, 'designer', { decision: 'APPROVED', observations: '', revision: current.revision }).expect(201)).body;
  await call('post', `/enrollments/courses/${course.id}/roster`, 'admin', { emails: [actors.ana.email, actors.beto.email] }).expect(200);
}
const notificationsOf = async (actor: Name) => (await db.query('SELECT type, title FROM collaboration.notifications WHERE "userId"=$1 ORDER BY "createdAt"', [actors[actor].id])).rows;
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean, timeout = 8000): Promise<T> {
  const start = Date.now(); for (;;) { const value = await read(); if (done(value) || Date.now() - start > timeout) return value; await new Promise(resolve => setTimeout(resolve, 150)); }
}

describe('Phase 8: forums, notifications and analytics on real PostgreSQL', () => {
  it('runs forums per unit with subscriptions, Observer notifications, moderation and immutable messages', async () => {
    const forum = (await call('post', `/collaboration/courses/${course.id}/forums`, 'teacher', { title: 'Consultas U1', unitId: course.units[0].id }).expect(201)).body;
    await call('post', `/collaboration/courses/${course.id}/forums`, 'ana', { title: 'No' }).expect(403);
    await call('get', `/collaboration/courses/${course.id}/forums`, 'outsider').expect(403);
    expect((await call('get', `/collaboration/courses/${course.id}/forums`, 'ana').expect(200)).body).toMatchObject({ access: 'PARTICIPATE', forums: [{ unitTitle: 'Unidad 1' }] });
    const thread = (await call('post', `/collaboration/forums/${forum.id}/threads`, 'ana', { title: 'Duda sobre pesos', body: '¿Cuánto vale el examen?' }).expect(201)).body;
    await call('post', `/collaboration/threads/${thread.id}/messages`, 'designer', { body: 'Hola' }).expect(403);
    const replied = (await call('post', `/collaboration/threads/${thread.id}/messages`, 'beto', { body: 'Vale 40 %' }).expect(201)).body;
    expect((await notificationsOf('teacher')).map((item: any) => item.type)).toEqual(['FORUM_NEW_THREAD', 'FORUM_REPLY']);
    expect((await notificationsOf('ana')).map((item: any) => item.type)).toEqual(['FORUM_REPLY']); expect(await notificationsOf('beto')).toEqual([]);
    await call('delete', `/collaboration/threads/${thread.id}/subscription`, 'ana').expect(200);
    await call('post', `/collaboration/threads/${thread.id}/messages`, 'teacher', { body: 'Confirmo: 40 %' }).expect(201);
    expect(await notificationsOf('ana')).toHaveLength(1); expect((await notificationsOf('beto')).map((item: any) => item.type)).toEqual(['FORUM_REPLY']);
    const offending = replied.messages[1];
    await call('patch', `/collaboration/messages/${offending.id}`, 'ana', { hidden: true, reason: 'x' }).expect(403);
    await call('patch', `/collaboration/messages/${offending.id}`, 'teacher', { hidden: true, reason: 'Información incorrecta' }).expect(200);
    const seen = (await call('get', `/collaboration/threads/${thread.id}`, 'ana').expect(200)).body.messages[1]; expect(seen).toMatchObject({ hidden: true, body: null, hiddenReason: null });
    expect((await call('get', `/collaboration/threads/${thread.id}`, 'admin').expect(200)).body.messages[1]).toMatchObject({ body: 'Vale 40 %', hiddenReason: 'Información incorrecta' });
    await expect(db.query('UPDATE collaboration.messages SET body=$1 WHERE id=$2', ['Editado', offending.id])).rejects.toThrow('cannot be edited');
    await call('patch', `/collaboration/threads/${thread.id}`, 'teacher', { locked: true, pinned: true }).expect(200);
    await call('post', `/collaboration/threads/${thread.id}/messages`, 'beto', { body: 'Otra' }).expect(409);
    const inbox = (await call('get', '/collaboration/notifications', 'teacher').expect(200)).body; expect(inbox.unread).toBe(2);
    expect((await call('post', '/collaboration/notifications/read', 'teacher', { ids: [inbox.notifications[0].id] }).expect(200)).body.unread).toBe(1);
    expect((await call('post', '/collaboration/notifications/read', 'teacher', {}).expect(200)).body.unread).toBe(0);
  });
  it('reminds enrolled students of upcoming due dates once and notifies students of new grades', async () => {
    const rubric = (await call('post', `/assessments/courses/${course.id}`, 'teacher', { title: 'Informe', instructions: '', type: 'RUBRIC', weight: 30,
      dueAt: new Date(Date.now() + 24 * 3_600_000).toISOString(), criteria: [{ description: 'Contenido', maxPoints: 20 }] }).expect(201)).body;
    await call('post', `/assessments/${rubric.id}/publish`, 'teacher', { revision: 0 }).expect(200);
    const reminded = await eventually(() => notificationsOf('ana'), rows => rows.some((row: any) => row.type === 'DUE_SOON'));
    expect(reminded.filter((row: any) => row.type === 'DUE_SOON')).toEqual([{ type: 'DUE_SOON', title: 'Vence pronto: Informe' }]);
    await new Promise(resolve => setTimeout(resolve, 800)); // several reminder runs later
    expect((await db.query(`SELECT count(*) FROM collaboration.notifications WHERE type='DUE_SOON' AND link->>'assessmentId'=$1`, [rubric.id])).rows[0].count).toBe('2');
    await call('post', `/grading/assessments/${rubric.id}/students/${actors.ana.id}`, 'teacher', { awards: [{ criterionId: rubric.criteria[0].id, points: 15 }] }).expect(200);
    const graded = await eventually(() => notificationsOf('ana'), rows => rows.some((row: any) => row.type === 'GRADE'));
    expect(graded.find((row: any) => row.type === 'GRADE')).toEqual({ type: 'GRADE', title: 'Nota registrada: Informe' });
  });
  it('accumulates connection minutes without inflation and builds the explainable risk dashboard', async () => {
    expect((await call('post', `/analytics/courses/${course.id}/heartbeat`, 'ana', {}, '198.51.100.1').expect(200)).body).toEqual({ tracked: true, minutesToday: 1 });
    expect((await call('post', `/analytics/courses/${course.id}/heartbeat`, 'ana', {}, '198.51.100.1').expect(200)).body).toEqual({ tracked: true, minutesToday: null });
    expect((await call('post', `/analytics/courses/${course.id}/heartbeat`, 'teacher').expect(200)).body).toEqual({ tracked: false, minutesToday: null });
    await call('post', `/analytics/courses/${course.id}/heartbeat`, 'outsider').expect(403);
    await call('post', `/courses/${course.id}/materials/${course.units[0].sessions[0].materials[0].id}/complete`, 'ana').expect(200);
    const view = (await call('get', `/analytics/courses/${course.id}`, 'teacher').expect(200)).body;
    expect(view.summary).toEqual({ students: 2, ALTO: 1, MEDIO: 0, BAJO: 1 });
    expect(view.students.find((row: any) => row.studentId === actors.ana.id)).toMatchObject({ level: 'BAJO', progress: 100, totalMinutes: 1, inactiveDays: 0 });
    expect(view.students.find((row: any) => row.studentId === actors.beto.id)).toMatchObject({ level: 'ALTO', reasons: ['Avance de contenidos 0% (mínimo 50%)', 'Sin actividad registrada en el curso'] });
    await call('get', `/analytics/courses/${course.id}`, 'designer').expect(200); await call('get', `/analytics/courses/${course.id}`, 'ana').expect(403);
    await call('put', `/analytics/courses/${course.id}/rules`, 'designer', { minProgress: 10, minAverage: 8, maxInactiveDays: 3, maxMissed: 1 }).expect(403);
    await call('put', `/analytics/courses/${course.id}/rules`, 'teacher', { minProgress: 101, minAverage: 8, maxInactiveDays: 3, maxMissed: 1 }).expect(400);
    const tuned = (await call('put', `/analytics/courses/${course.id}/rules`, 'teacher', { minProgress: 10, minAverage: 8, maxInactiveDays: 3, maxMissed: 1 }).expect(200)).body;
    expect(tuned.rules).toEqual({ minProgress: 10, minAverage: 8, maxInactiveDays: 3, maxMissed: 1, custom: true });
    expect((await db.query('SELECT "minAverageCents", "updatedBy" FROM analytics.risk_rules WHERE "courseId"=$1', [course.id])).rows[0]).toEqual({ minAverageCents: 800, updatedBy: actors.teacher.id });
  });
});
