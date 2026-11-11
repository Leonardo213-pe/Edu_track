import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
let app: Awaited<ReturnType<typeof createApplication>>, folder: string, hash: string;
let actors: Record<string, { id: string; email: string; token: string }>, courseIds: string[], current: any;
const pdf = Buffer.from('%PDF-1.7\nTest document content\n%%EOF');
beforeAll(async () => { await mkdir(path.resolve('../../tmp'), { recursive: true }); hash = await new ScryptPasswordHasher().hash(password); });
beforeEach(async () => {
  folder = await mkdtemp(path.resolve('../../tmp/course-integration-'));
  actors = {}; courseIds = [];
  for (const name of ['teacher', 'other', 'designer', 'student', 'admin']) {
    const role = name === 'other' || name === 'teacher' ? 'TEACHER' : name === 'designer' ? 'INSTRUCTIONAL_DESIGNER' : name === 'student' ? 'STUDENT' : 'ADMIN';
    const user = new User(randomUUID(), `${randomUUID()}@example.test`, `QA ${name}`, hash, role, new Date()); await users.create(user); actors[name] = { id: user.id, email: user.email, token: '' };
  }
  app = await createApplication({ databaseUrl, jwtSecret: secret, port: 3000, webOrigin: 'http://localhost:5173', mail: { host: 'localhost', port: 1025, from: 'qa@example.test', secure: false, requireTLS: false, webOrigin: 'http://localhost:5173' },
    academic: { storageRoot: path.join(folder, 'files') } }); await app.init();
  for (const actor of Object.values(actors)) {
    const user = (await users.findById(actor.id))!;
    actor.token = (await request(app.getHttpServer()).post('/api/identity/login').send({ email: user.email, password }).expect(200)).body.accessToken;
  }
});
afterEach(async () => { await app?.close(); await db.query('DELETE FROM enrollments.enrollments WHERE "courseId"=ANY($1::uuid[])', [courseIds]); await db.query('DELETE FROM courses.courses WHERE id=ANY($1::uuid[])', [courseIds]); await db.query('DELETE FROM identity.users WHERE id=ANY($1::uuid[])', [Object.values(actors).map(actor => actor.id)]); await rm(folder, { recursive: true, force: true }); });
afterAll(async () => { await users.onModuleDestroy(); await db.end(); });
function get(route: string, actor = 'teacher') { return request(app.getHttpServer()).get(`/api/courses${route}`).auth(actors[actor]!.token, { type: 'bearer' }); }
function send(route: string, body: unknown, actor = 'teacher', method: 'post' | 'patch' = 'post') { return request(app.getHttpServer())[method](`/api/courses${route}`).auth(actors[actor]!.token, { type: 'bearer' }).send(body); }
async function create() {
  current = (await send('', { code: `QA-${randomUUID().slice(0, 8)}`, name: 'Arquitectura de software', description: 'Curso real de pruebas', period: '2026-II', teacherId: actors.teacher!.id }).expect(201)).body; courseIds.push(current.id); return current;
}
async function change(route: string, body: object, actor = 'teacher', method: 'post' | 'patch' = 'post') {
  current = (await send(`/${current.id}${route}`, { revision: current.revision, ...body }, actor, method).expect(method === 'patch' ? 200 : 201)).body; return current;
}
async function ready() {
  await create(); await change('', { code: current.code, name: current.name, description: current.description, period: current.period, teacherId: current.teacherId, syllabus: 'Resultados de aprendizaje y programación.' }, 'teacher', 'patch');
  await change('/units', { title: 'Fundamentos' }); await change(`/units/${current.units[0].id}/sessions`, { title: 'Arquitectura hexagonal', description: 'Sesión introductoria' });
  await change(`/sessions/${current.units[0].sessions[0].id}/materials`, { title: 'Referencia', kind: 'LINK', url: 'https://example.test/course' });
  await enroll([actors.student!.email]); return current;
}
async function enroll(emails: string[], actor = 'admin', status = 200) {
  return request(app.getHttpServer()).post(`/api/enrollments/courses/${current.id}/roster`).auth(actors[actor]!.token, { type: 'bearer' }).send({ emails }).expect(status);
}
async function publish() { await change('/transitions', { decision: 'SUBMITTED', observations: '' }); await change('/transitions', { decision: 'APPROVED', observations: 'Conforme' }, 'designer'); }
describe('Courses: real Nest/PostgreSQL/files with the persisted enrollment projection', () => {
  it('creates a draft, validates input, checks teacher assignment and public identity contract', async () => {
    await create(); expect(current.status).toBe('BORRADOR'); expect((await db.query('SELECT name FROM courses.courses WHERE id=$1', [current.id])).rows[0].name).toBe(current.name);
    await send('', { code: '', name: 'Bad', description: 'Bad', period: '2026', teacherId: actors.teacher!.id }).expect(400);
    await send('', { code: 'BAD', name: 'Bad', description: 'Bad', period: '2026', teacherId: actors.student!.id }, 'admin').expect(400);
    await send('', { code: 'BAD', name: 'Bad', description: 'Bad', period: '2026', teacherId: actors.other!.id }).expect(403);
    expect((await get('/teachers', 'admin').expect(200)).body).toHaveLength(2); await get('/teachers', 'student').expect(403);
  });
  it('creates, edits and reorders units/sessions with stable hierarchy and revision conflicts', async () => {
    await ready(); const first = current.units[0].id; await change('/units', { title: 'Segunda unidad' }); const second = current.units[1].id;
    await change('/order', { type: 'units', parentId: current.id, ids: [second, first] }); expect(current.units.map((unit: any) => unit.id)).toEqual([second, first]);
    await change(`/units/${second}`, { title: 'Unidad editada' }, 'teacher', 'patch');
    await change(`/units/${first}/sessions`, { title: 'Segunda sesión', description: '' }); const unit = current.units.find((unit: any) => unit.id === first); const ids = unit.sessions.map((session: any) => session.id).reverse();
    await change('/order', { type: 'sessions', parentId: first, ids }); await change(`/sessions/${ids[0]}`, { title: 'Sesión editada', description: 'Detalle' }, 'teacher', 'patch');
    await send(`/${current.id}/units`, { revision: 0, title: 'Stale' }).expect(409);
    await send(`/${current.id}/order`, { revision: current.revision, type: 'units', parentId: current.id, ids: [first, first] }).expect(400);
  });
  it('stores real bytes, validates file types and retains every historical version', async () => {
    await ready(); const session = current.units[0].sessions[0];
    const upload = await request(app.getHttpServer()).post(`/api/courses/${current.id}/sessions/${session.id}/materials`).auth(actors.teacher!.token, { type: 'bearer' })
      .field('revision', String(current.revision)).field('title', 'Guía PDF').field('kind', 'FILE').attach('file', pdf, { filename: 'guia.pdf', contentType: 'application/pdf' }).expect(201);
    current = upload.body; const material = current.units[0].sessions[0].materials[1]; const first = material.versions[0]; expect(first.storageKey).toBeNull();
    const row = (await db.query('SELECT "storageKey", sha256 FROM courses.material_versions WHERE id=$1', [first.id])).rows[0];
    expect(await readFile(path.join(folder, 'files', row.storageKey))).toEqual(pdf); expect(row.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
    const second = Buffer.from('%PDF-1.7\nA new revision\n%%EOF');
    current = (await request(app.getHttpServer()).post(`/api/courses/${current.id}/sessions/${session.id}/materials`).auth(actors.teacher!.token, { type: 'bearer' })
      .field('revision', String(current.revision)).field('title', 'Guía PDF actualizada').field('kind', 'FILE').field('materialId', material.id).attach('file', second, { filename: 'guia-v2.pdf', contentType: 'application/pdf' }).expect(201)).body;
    const versions = current.units[0].sessions[0].materials[1].versions; expect(versions.map((version: any) => version.number)).toEqual([1, 2]); expect(await readdir(path.join(folder, 'files'))).toHaveLength(2);
    await get(`/${current.id}/materials/${material.id}/versions/${first.id}/file`).expect(200);
    await expect(db.query('UPDATE courses.material_versions SET number=99 WHERE id=$1', [first.id])).rejects.toThrow('cannot be overwritten');
    await request(app.getHttpServer()).post(`/api/courses/${current.id}/sessions/${session.id}/materials`).auth(actors.teacher!.token, { type: 'bearer' })
      .field('revision', String(current.revision)).field('title', 'Malicioso').field('kind', 'FILE').attach('file', Buffer.from('<html>bad</html>'), { filename: 'fake.pdf', contentType: 'application/pdf' }).expect(400);
    expect(await readdir(path.join(folder, 'files'))).toHaveLength(2);
  });
  it('records rejection observations, resubmission and approval in the same transaction as course state', async () => {
    await ready(); await send(`/${current.id}/transitions`, { revision: current.revision, decision: 'APPROVED', observations: '' }, 'designer').expect(409);
    await change('/transitions', { decision: 'SUBMITTED', observations: '' }); await send(`/${current.id}/transitions`, { revision: current.revision, decision: 'APPROVED', observations: '' }).expect(403);
    await send(`/${current.id}/transitions`, { revision: current.revision, decision: 'REJECTED', observations: '' }, 'designer').expect(400);
    await change('/transitions', { decision: 'REJECTED', observations: 'Ampliar los resultados de aprendizaje' }, 'designer'); expect(current.status).toBe('BORRADOR');
    expect((await db.query('SELECT observations FROM courses.reviews WHERE "courseId"=$1 AND decision=$2', [current.id, 'REJECTED'])).rows[0].observations).toContain('aprendizaje');
    await publish(); expect(current.status).toBe('PUBLICADO'); await get(`/${current.id}`, 'student').expect(200);
  });
  it('denies drafts, missing enrollments, forged actors and foreign courses through the HTTP API', async () => {
    await ready(); await get(`/${current.id}`, 'student').expect(403); await get(`/${current.id}`, 'other').expect(403);
    await send(`/${current.id}/units`, { revision: current.revision, title: 'Injected', actorId: actors.teacher!.id, role: 'ADMIN' }, 'student').expect(400);
    await send(`/${current.id}/units`, { revision: current.revision, title: 'Foreign' }, 'other').expect(403);
    await request(app.getHttpServer()).get(`/api/courses/${current.id}`).expect(401); await publish();
    await enroll([]); await get(`/${current.id}`, 'student').expect(403); expect((await get('', 'student')).body).toEqual([]);
  });
  it('computes progress idempotently and withdraws published content before revisions', async () => {
    await ready(); const sessionId = current.units[0].sessions[0].id; await change(`/sessions/${sessionId}/materials`, { title: 'Segundo recurso', kind: 'VIDEO', url: 'https://example.test/video' }); await publish();
    const materialId = current.units[0].sessions[0].materials[0].id;
    const completed = await send(`/${current.id}/materials/${materialId}/complete`, {}, 'student').expect(200); expect(completed.body.progress.percentage).toBe(50);
    await send(`/${current.id}/materials/${materialId}/complete`, {}, 'student').expect(200); expect((await db.query('SELECT count(*) FROM courses.completions WHERE "courseId"=$1', [current.id])).rows[0].count).toBe('1');
    expect((await get(`/${current.id}/progress`, 'admin')).body[0].percentage).toBe(50); await get(`/${current.id}/progress`, 'student').expect(403);
    await send(`/${current.id}/units`, { revision: current.revision, title: 'No revisada' }).expect(409);
    await change('/transitions', { decision: 'REOPENED', observations: 'Nueva versión' }); await get(`/${current.id}`, 'student').expect(403);
    await change(`/sessions/${sessionId}/materials`, { title: 'Recurso actualizado', materialId, kind: 'LINK', url: 'https://example.test/new' }); await publish();
    expect((await get(`/${current.id}`, 'student')).body.progress.percentage).toBe(0);
    await change('/transitions', { decision: 'ARCHIVED', observations: '' }); await get(`/${current.id}`, 'student').expect(403); await send(`/${current.id}/units`, { revision: current.revision, title: 'No' }).expect(409);
  });
  it('rejects dangerous URLs and incomplete courses and does not lose updates under concurrency', async () => {
    await create(); await send(`/${current.id}/transitions`, { revision: current.revision, decision: 'SUBMITTED', observations: '' }).expect(400);
    const responses = await Promise.all([send(`/${current.id}/units`, { revision: 0, title: 'Primera' }), send(`/${current.id}/units`, { revision: 0, title: 'Concurrente' })]); expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    current = (await get(`/${current.id}`)).body; await change(`/units/${current.units[0].id}/sessions`, { title: 'Sesión', description: '' });
    await send(`/${current.id}/sessions/${current.units[0].sessions[0].id}/materials`, { revision: current.revision, title: 'Inyección', kind: 'LINK', url: 'javascript:alert(1)' }).expect(400);
  });
  it('persists the official roster, reconciles altas/bajas atomically and keeps an append-only run log', async () => {
    await ready(); await publish(); const outsider = new User(randomUUID(), `${randomUUID()}@example.test`, 'QA second', hash, 'STUDENT', new Date());
    await users.create(outsider); actors.second = { id: outsider.id, email: outsider.email, token: '' };
    expect((await get('', 'student')).body.map((course: any) => course.id)).toEqual([current.id]);
    await enroll([actors.student!.email], 'student', 403); await enroll([actors.student!.email], 'teacher', 403);
    await request(app.getHttpServer()).get(`/api/enrollments/courses/${current.id}`).auth(actors.designer!.token, { type: 'bearer' }).expect(403);
    const rejected = await enroll([outsider.email, actors.teacher!.email, 'nadie@example.test'], 'admin', 400);
    expect(rejected.body).toMatchObject({ code: 'UNKNOWN_STUDENTS', unknown: [actors.teacher!.email, 'nadie@example.test'] });
    expect((await db.query('SELECT count(*) FROM enrollments.enrollments WHERE "courseId"=$1 AND active', [current.id])).rows[0].count).toBe('1');
    const synced = (await enroll([outsider.email.toUpperCase()])).body; expect(synced).toMatchObject({ added: 1, removed: 1, total: 1, students: [{ id: outsider.id, email: outsider.email }] });
    expect((await enroll([outsider.email])).body).toMatchObject({ added: 0, removed: 0, unchanged: 1 });
    await get(`/${current.id}`, 'student').expect(403);
    const rows = (await db.query('SELECT "studentId", active FROM enrollments.enrollments WHERE "courseId"=$1 ORDER BY active', [current.id])).rows;
    expect(rows).toEqual([{ studentId: actors.student!.id, active: false }, { studentId: outsider.id, active: true }]);
    const runs = (await db.query('SELECT id, added, removed FROM enrollments.runs WHERE "courseId"=$1 ORDER BY "occurredAt"', [current.id])).rows;
    expect(runs.map((run: any) => [run.added, run.removed])).toEqual([[1, 0], [1, 1], [0, 0]]);
    await expect(db.query('UPDATE enrollments.runs SET added=9 WHERE id=$1', [runs[0].id])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM enrollments.runs WHERE id=$1', [runs[0].id])).rejects.toThrow('append-only');
    await db.query('DELETE FROM identity.users WHERE id=$1', [outsider.id]);
  });
  it('removes structure and stored files only from never-published drafts and records the course history', async () => {
    await ready(); const session = current.units[0].sessions[0];
    current = (await request(app.getHttpServer()).post(`/api/courses/${current.id}/sessions/${session.id}/materials`).auth(actors.teacher!.token, { type: 'bearer' })
      .field('revision', String(current.revision)).field('title', 'Guía').field('kind', 'FILE').attach('file', pdf, { filename: 'guia.pdf', contentType: 'application/pdf' }).expect(201)).body;
    expect(current.removable).toBe(true); expect(await readdir(path.join(folder, 'files'))).toHaveLength(1);
    const fileMaterial = current.units[0].sessions[0].materials[1];
    await request(app.getHttpServer()).delete(`/api/courses/${current.id}/materials/${fileMaterial.id}?revision=${current.revision}`).auth(actors.other!.token, { type: 'bearer' }).expect(403);
    await request(app.getHttpServer()).delete(`/api/courses/${current.id}/materials/${fileMaterial.id}?revision=0`).auth(actors.teacher!.token, { type: 'bearer' }).expect(409);
    current = (await request(app.getHttpServer()).delete(`/api/courses/${current.id}/materials/${fileMaterial.id}?revision=${current.revision}`).auth(actors.teacher!.token, { type: 'bearer' }).expect(200)).body;
    expect(current.units[0].sessions[0].materials).toHaveLength(1); expect(await readdir(path.join(folder, 'files'))).toHaveLength(0);
    await change('/units', { title: 'Temporal' }); const temporary = current.units[1].id;
    await change(`/units/${temporary}/sessions`, { title: 'Sesión temporal', description: '', durationMinutes: 45 }); expect(current.durationMinutes).toBe(45);
    current = (await request(app.getHttpServer()).delete(`/api/courses/${current.id}/units/${temporary}?revision=${current.revision}`).auth(actors.teacher!.token, { type: 'bearer' }).expect(200)).body;
    expect(current.units.map((unit: any) => [unit.title, unit.position])).toEqual([['Fundamentos', 0]]);
    expect((await db.query('SELECT count(*) FROM courses.sessions s JOIN courses.units u ON u.id=s."unitId" WHERE u."courseId"=$1', [current.id])).rows[0].count).toBe('1');
    await change(`/sessions/${session.id}`, { title: 'Arquitectura hexagonal', description: 'Sesión introductoria', durationMinutes: 90 }, 'teacher', 'patch'); expect(current.durationMinutes).toBe(90);
    await publish(); await change('/transitions', { decision: 'REOPENED', observations: 'Actualizar' }); expect(current.removable).toBe(false);
    await request(app.getHttpServer()).delete(`/api/courses/${current.id}/sessions/${session.id}?revision=${current.revision}`).auth(actors.teacher!.token, { type: 'bearer' }).expect(409);
    const history = (await get(`/${current.id}/history`, 'designer').expect(200)).body; const actions = history.map((entry: any) => entry.action);
    for (const action of ['COURSE_CREATED', 'SYLLABUS_EDITED', 'MATERIAL_REMOVED', 'UNIT_REMOVED', 'SESSION_EDITED', 'STATUS_CHANGED']) expect(actions).toContain(action);
    expect(history.find((entry: any) => entry.action === 'SESSION_EDITED').detail.durationMinutes).toEqual({ before: 0, after: 90 });
    expect(history[0]).toMatchObject({ actorName: 'QA teacher' }); await get(`/${current.id}/history`, 'student').expect(403); await get(`/${current.id}/history`, 'other').expect(403);
    await expect(db.query('UPDATE courses.changes SET action=$1 WHERE "courseId"=$2', ['X', current.id])).rejects.toThrow('append-only');
    await expect(db.query('UPDATE courses.reviews SET observations=$1 WHERE "courseId"=$2', ['X', current.id])).rejects.toThrow('cannot be modified');
  });
  it('authorizes uploads before reading the multipart body and validates durations', async () => {
    await ready(); const session = current.units[0].sessions[0];
    await request(app.getHttpServer()).post(`/api/courses/${current.id}/sessions/${session.id}/materials`).auth(actors.student!.token, { type: 'bearer' })
      .field('revision', String(current.revision)).field('title', 'Intrusión').field('kind', 'FILE').attach('file', pdf, { filename: 'x.pdf', contentType: 'application/pdf' }).expect(403);
    await send(`/${current.id}/units/${current.units[0].id}/sessions`, { revision: current.revision, title: 'Mala', description: '', durationMinutes: 2000 }).expect(400);
    expect(await readdir(path.join(folder, 'files')).catch(() => [])).toHaveLength(0);
  });
});
