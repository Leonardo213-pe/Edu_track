import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import { createApplication } from '../dist/bootstrap.js';
import { PrismaUserRepository } from '../dist/modules/identity/infrastructure/persistence/prisma-user-repository.js';
import { ScryptPasswordHasher } from '../dist/modules/identity/infrastructure/security/scrypt-password-hasher.js';
import { User } from '../dist/modules/identity/domain/user.js';

// Part C on real PostgreSQL: the API runs with the least-privilege role, request metrics and audit anchors work with it.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/edutrack_test') throw new Error('Only explicit edutrack_test DB is allowed');
const secret = randomBytes(48).toString('hex'), password = randomBytes(16).toString('hex'), appPassword = randomBytes(24).toString('hex');
const appUrl = (() => { const url = new URL(databaseUrl); url.username = 'edutrack_app'; url.password = appPassword; return url.toString(); })();
const owner = new Pool({ connectionString: databaseUrl }), users = new PrismaUserRepository(databaseUrl, secret);
let app: Awaited<ReturnType<typeof createApplication>>, runtime: Pool, folder: string;
const actors: Record<'admin' | 'teacher', { id: string; email: string; token: string }> = {} as never;

beforeAll(async () => {
  execFileSync(process.execPath, [path.resolve('scripts/provision-app-role.mjs')], { env: { ...process.env, DATABASE_URL: databaseUrl, APP_DB_PASSWORD: appPassword }, stdio: 'pipe' });
  runtime = new Pool({ connectionString: appUrl });
  await mkdir(path.resolve('../../tmp'), { recursive: true }); folder = await mkdtemp(path.resolve('../../tmp/operations-integration-'));
  const hash = await new ScryptPasswordHasher().hash(password);
  for (const [name, role] of [['admin', 'ADMIN'], ['teacher', 'TEACHER']] as const) {
    const user = new User(randomUUID(), `${randomUUID()}@example.test`, `QA ${name}`, hash, role, new Date()); await users.create(user);
    actors[name] = { id: user.id, email: user.email, token: '' };
  }
  // Make sure the audit chain is not empty so there is a head to anchor.
  await owner.query(`SELECT set_config('edutrack.actor', $1, false)`, [actors.admin.id]);
  await owner.query(`SELECT audit.append_entry('GRADE', $1::uuid, 'INSERT', NULL, '{"qa":true}'::jsonb, $2::uuid)`, [randomUUID(), actors.admin.id]);
  app = await createApplication({ databaseUrl: appUrl, jwtSecret: secret, port: 3000, webOrigin: 'http://localhost:5173', trustProxy: 'loopback',
    mail: { host: 'localhost', port: 1025, from: 'qa@example.test', secure: false, requireTLS: false, webOrigin: 'http://localhost:5173' },
    academic: { storageRoot: path.join(folder, 'files') }, audit: { anchorDir: path.join(folder, 'anchors') }, monitoring: { flushMs: 200, instanceId: 'qa-replica' } });
  await app.init();
  let address = 0;
  for (const actor of Object.values(actors)) actor.token = (await request(app.getHttpServer()).post('/api/identity/login').set('X-Forwarded-For', `192.0.2.${200 + ++address}`)
    .send({ email: actor.email, password }).expect(200)).body.accessToken;
});
afterAll(async () => {
  await app?.close(); await runtime?.end();
  await owner.query('DELETE FROM identity.users WHERE id=ANY($1::uuid[])', [Object.values(actors).map(actor => actor.id)]);
  await owner.query(`DELETE FROM administration.instances WHERE id='qa-replica'`); await owner.query(`DELETE FROM administration.request_metrics WHERE instance='qa-replica'`);
  await users.onModuleDestroy(); await owner.end(); await rm(folder, { recursive: true, force: true });
});
const call = (route: string, actor: 'admin' | 'teacher') => request(app.getHttpServer()).get(`/api${route}`).auth(actors[actor].token, { type: 'bearer' });

describe('operations with the least-privilege database role', () => {
  it('denies the runtime role ownership, DDL and any rewrite of the audit log', async () => {
    const role = (await owner.query(`SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname='edutrack_app'`)).rows[0];
    expect(role).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false });
    expect((await owner.query(`SELECT count(*)::int AS owned FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname='edutrack_app'`)).rows[0].owned).toBe(0);
    await expect(runtime.query('UPDATE audit.entries SET "actorId"="actorId" WHERE id = (SELECT max(id) FROM audit.entries)')).rejects.toThrow(/permission denied/);
    await expect(runtime.query('DELETE FROM audit.entries WHERE false')).rejects.toThrow(/permission denied/);
    await expect(runtime.query('TRUNCATE audit.entries')).rejects.toThrow(/permission denied/);
    await expect(runtime.query('CREATE TABLE identity.qa_probe (id int)')).rejects.toThrow(/permission denied/);
    await expect(runtime.query('SELECT count(*) FROM identity."_prisma_migrations"')).rejects.toThrow(/permission denied/);
    expect((await runtime.query('SELECT checked FROM audit.verify_chain()')).rows[0].checked).toBeTruthy();
  });
  it('anchors the audit chain head on a separate directory and verifies it against the database', async () => {
    let lines: string[] = [];
    for (let i = 0; i < 30 && !lines.length; i++) { lines = (await readFile(path.join(folder, 'anchors', 'audit-anchors.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean); if (!lines.length) await new Promise(resolve => setTimeout(resolve, 100)); }
    const head = (await owner.query('SELECT id::text, hash FROM audit.entries ORDER BY id DESC LIMIT 1')).rows[0];
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ entryId: head.id, hash: head.hash });
    expect((await call('/audit/anchors/verify', 'admin').expect(200)).body).toMatchObject({ configured: true, valid: true, firstMismatch: null });
    await call('/audit/anchors/verify', 'teacher').expect(403);
  });
  it('records request metrics by route template and serves the ADMIN monitoring panel', async () => {
    for (let i = 0; i < 3; i++) await call(`/courses/${randomUUID()}`, 'admin');
    let panel: any;
    for (let i = 0; i < 40; i++) {
      panel = (await call('/administration/monitoring?minutes=5', 'admin').expect(200)).body;
      if (panel.routes.some((route: any) => route.route === '/api/courses/:id')) break; await new Promise(resolve => setTimeout(resolve, 150));
    }
    const route = panel.routes.find((item: any) => item.route === '/api/courses/:id');
    expect(route).toMatchObject({ method: 'GET', count: 3 }); expect(route.p95Ms).toBeGreaterThan(0);
    expect(panel.replicas.find((replica: any) => replica.id === 'qa-replica')).toMatchObject({ alive: true });
    expect(panel).toHaveProperty('activeAttempts'); expect(Object.keys(panel.outboxes)).toHaveLength(2);
    expect(panel.jobs.map((job: any) => job.name)).toContain('Anclaje de auditoría');
    // Concrete IDs never reach the metrics table (route templates only).
    expect((await owner.query(`SELECT count(*)::int AS n FROM administration.request_metrics WHERE route ~ '[0-9a-f]{8}-'`)).rows[0].n).toBe(0);
    await call('/administration/monitoring', 'teacher').expect(403);
  });
});
