import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import { createApplication } from '../dist/bootstrap.js';
import { PrismaUserRepository } from '../dist/modules/identity/infrastructure/persistence/prisma-user-repository.js';
import { ScryptPasswordHasher } from '../dist/modules/identity/infrastructure/security/scrypt-password-hasher.js';
import { User } from '../dist/modules/identity/domain/user.js';

// Real PostgreSQL + the SIMULATED Academic Registry (infra/registry/server.mjs) running as a separate process over HTTP.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/edutrack_test') throw new Error('Only explicit edutrack_test DB is allowed');
const secret = randomBytes(48).toString('hex'), password = randomBytes(16).toString('hex'), registryKey = randomBytes(24).toString('hex');
const registryPort = 46000 + Math.floor(Math.random() * 1000), registryUrl = `http://127.0.0.1:${registryPort}`;
const users = new PrismaUserRepository(databaseUrl, secret), db = new Pool({ connectionString: databaseUrl });
const roles = { teacher: 'TEACHER', ana: 'STUDENT', beto: 'STUDENT', admin: 'ADMIN' } as const;
type Name = keyof typeof roles;
let app: Awaited<ReturnType<typeof createApplication>>, registry: ChildProcess, course: any;
let actors: Record<Name, { id: string; email: string; token: string }>;

async function control(route: string, body: unknown) {
  const response = await fetch(`${registryUrl}${route}`, { method: 'PUT', headers: { 'X-Registry-Key': registryKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect(response.status).toBe(200);
}
beforeAll(async () => {
  registry = spawn(process.execPath, [path.resolve('../../infra/registry/server.mjs')], { env: { ...process.env, PORT: String(registryPort), REGISTRY_API_KEY: registryKey }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${registryUrl}/health`)).ok) break; } catch { /* starting */ } await new Promise(resolve => setTimeout(resolve, 100)); }
  const hash = await new ScryptPasswordHasher().hash(password); actors = {} as typeof actors;
  for (const [name, role] of Object.entries(roles)) {
    const user = new User(randomUUID(), `${randomUUID()}@example.test`, `QA ${name}`, hash, role, new Date()); await users.create(user);
    actors[name as Name] = { id: user.id, email: user.email, token: '' };
  }
});
beforeEach(async () => {
  await control('/admin/mode', { mode: 'up', failNext: 0 });
  app = await createApplication({ databaseUrl: databaseUrl!, jwtSecret: secret, port: 3000, webOrigin: 'http://localhost:5173', trustProxy: 'loopback',
    mail: { host: 'localhost', port: 1025, from: 'qa@example.test', secure: false, requireTLS: false, webOrigin: 'http://localhost:5173' },
    registry: { url: registryUrl, apiKey: registryKey, retryBaseMs: 100 }, alertIntervalMs: 200 });
  await app.init();
  let address = 0;
  for (const actor of Object.values(actors)) actor.token = (await request(app.getHttpServer()).post('/api/identity/login').set('X-Forwarded-For', `198.51.100.${++address}`)
    .send({ email: actor.email, password }).expect(200)).body.accessToken;
  course = (await call('post', '/courses', 'teacher', { code: `RG-${randomUUID().slice(0, 8)}`, name: 'Registro QA', description: 'Curso', period: '2026-II', teacherId: actors.teacher.id }).expect(201)).body;
});
afterEach(async () => {
  await app?.close();
  await db.query('DELETE FROM enrollments.enrollments WHERE "courseId"=$1', [course?.id]);
  await db.query('DELETE FROM enrollments.sections WHERE "courseId"=$1', [course?.id]);
  await db.query('DELETE FROM courses.courses WHERE id=$1', [course?.id]);
});
afterAll(async () => {
  registry?.kill();
  await db.query('DELETE FROM collaboration.notifications WHERE "userId"=ANY($1::uuid[])', [Object.values(actors).map(actor => actor.id)]);
  await db.query('DELETE FROM identity.users WHERE id=ANY($1::uuid[])', [Object.values(actors).map(actor => actor.id)]);
  await users.onModuleDestroy(); await db.end();
});
function call(method: 'get' | 'post' | 'patch', route: string, actor: Name, body?: unknown) {
  const pending = request(app.getHttpServer())[method](`/api${route}`).auth(actors[actor].token, { type: 'bearer' });
  return body === undefined ? pending : pending.send(body);
}
const active = async () => (await db.query('SELECT "studentId" FROM enrollments.enrollments WHERE "courseId"=$1 AND active ORDER BY "studentId"', [course.id])).rows.map(row => row.studentId);
const roster = (...names: Name[]) => control(`/admin/sections/${course.code}/2026-II`, { students: [...names.map(name => ({ email: actors[name].email })), { email: 'ghost@alumnos.edutrack.test' }] });

describe('nightly enrollment synchronization with the SIMULATED Academic Registry', () => {
  it('links the course section on creation and reconciles altas/bajas idempotently with source REGISTRY_SYNC', async () => {
    expect((await db.query('SELECT code, period FROM enrollments.sections WHERE "courseId"=$1', [course.id])).rows).toEqual([{ code: course.code, period: '2026-II' }]);
    await roster('ana', 'beto');
    const first = (await call('post', '/enrollments/registry/sync', 'admin').expect(200)).body;
    expect(first).toMatchObject({ trigger: 'MANUAL', status: 'SUCCEEDED', retries: 0, error: null });
    expect(first.added).toBeGreaterThanOrEqual(2); expect(first.unknown).toBeGreaterThanOrEqual(1);
    expect(await active()).toEqual([actors.ana.id, actors.beto.id].sort());
    const runs = (await db.query('SELECT source, "actorId", added FROM enrollments.runs WHERE "courseId"=$1', [course.id])).rows;
    expect(runs).toEqual([{ source: 'REGISTRY_SYNC', actorId: '00000000-0000-4000-8000-000000000000', added: 2 }]);
    await roster('ana');
    await call('post', '/enrollments/registry/sync', 'admin').expect(200);
    expect(await active()).toEqual([actors.ana.id]);
    await call('post', '/enrollments/registry/sync', 'admin').expect(200);
    expect((await db.query('SELECT added, removed FROM enrollments.runs WHERE "courseId"=$1 ORDER BY "occurredAt" DESC LIMIT 1', [course.id])).rows[0]).toEqual({ added: 0, removed: 0 });
    // The enrolled student now sees the course once it is published (projection consumed by courses).
    expect((await call('get', '/enrollments/registry', 'admin').expect(200)).body).toMatchObject({ registry: { configured: true, reachable: true, simulated: true, mode: 'up' }, schedule: { time: '02:00' } });
  });
  it('denies non administrators', async () => {
    await call('post', '/enrollments/registry/sync', 'teacher').expect(403);
    await call('get', '/enrollments/registry', 'ana').expect(403);
  });
  it('retries transient failures with backoff and succeeds', async () => {
    await roster('ana'); await control('/admin/mode', { failNext: 2 });
    const run = (await call('post', '/enrollments/registry/sync', 'admin').expect(200)).body;
    expect(run).toMatchObject({ status: 'SUCCEEDED', retries: 2 });
    expect(await active()).toEqual([actors.ana.id]);
  });
  it('records a FAILED run after 3 retries, keeps the projection and alerts the administrators in the inbox', async () => {
    await roster('ana'); await call('post', '/enrollments/registry/sync', 'admin').expect(200);
    await control('/admin/mode', { mode: 'down' });
    const run = (await call('post', '/enrollments/registry/sync', 'admin').expect(200)).body;
    expect(run).toMatchObject({ status: 'FAILED', retries: 3, error: 'REGISTRY_UNAVAILABLE: HTTP_503' });
    expect(await active()).toEqual([actors.ana.id]);
    // The LMS keeps answering while the registry is down.
    await call('get', `/courses/${course.id}`, 'teacher').expect(200);
    const alert = async () => (await db.query(`SELECT title FROM collaboration.notifications WHERE "userId"=$1 AND type='SYSTEM_ALERT' AND "dedupeKey" LIKE $2`, [actors.admin.id, `REGISTRY_SYNC_FAILED:${run.id}:%`])).rows;
    for (let i = 0; i < 50 && !(await alert()).length; i++) await new Promise(resolve => setTimeout(resolve, 100));
    expect(await alert()).toEqual([{ title: 'Falló la sincronización con el Registro Académico' }]);
    expect((await call('get', '/enrollments/registry', 'admin').expect(200)).body.registry).toMatchObject({ reachable: true, mode: 'down' });
  });
  it('never runs two synchronizations at once and keeps finished runs immutable', async () => {
    await roster('ana'); await control('/admin/mode', { failNext: 3 });
    const [a, b] = await Promise.all([call('post', '/enrollments/registry/sync', 'admin'), new Promise(resolve => setTimeout(resolve, 50)).then(() => call('post', '/enrollments/registry/sync', 'admin'))]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body.code, b.body.code]).toContain('SYNC_IN_PROGRESS');
    const id = (a.status === 200 ? a : b).body.id;
    await expect(db.query(`UPDATE enrollments.sync_runs SET error='x' WHERE id=$1`, [id])).rejects.toThrow(/immutable/);
    await expect(db.query('DELETE FROM enrollments.sync_runs WHERE id=$1', [id])).rejects.toThrow(/cannot be deleted/);
    await expect(db.query(`INSERT INTO enrollments.sync_runs (id, trigger, slot, "actorId", status, "startedAt", "finishedAt") VALUES ($1, 'SCHEDULED', 'NIGHTLY:QA-${id}', $2, 'SUCCEEDED', now(), now()), ($3, 'SCHEDULED', 'NIGHTLY:QA-${id}', $2, 'SUCCEEDED', now(), now())`,
      [randomUUID(), actors.admin.id, randomUUID()])).rejects.toThrow(/sync_runs_slot_key/);
  });
});
