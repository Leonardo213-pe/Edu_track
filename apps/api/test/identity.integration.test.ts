import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
// Test the compiled Nest application, including real decorator metadata and ValidationPipe.
import { createApplication } from '../dist/bootstrap.js';
import { PrismaUserRepository } from '../dist/modules/identity/infrastructure/persistence/prisma-user-repository.js';
import { ScryptPasswordHasher } from '../dist/modules/identity/infrastructure/security/scrypt-password-hasher.js';
import { User } from '../dist/modules/identity/domain/user.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/edutrack_test')
  throw new Error('TEST_DATABASE_URL must explicitly target the disposable edutrack_test database. No fallback.');
const secret = randomBytes(48).toString('hex');
const password = randomBytes(16).toString('hex');
const adminEmail = `${randomUUID()}@example.test`;
const adminId = randomUUID();
const users = new PrismaUserRepository(databaseUrl);
const db = new Pool({ connectionString: databaseUrl });
let app: Awaited<ReturnType<typeof createApplication>>;
let adminToken: string;
let studentToken: string;
const createdIds: string[] = [adminId];
beforeAll(async () => {
  await users.create(new User(adminId, adminEmail, 'Test admin', await new ScryptPasswordHasher().hash(password), 'ADMIN', new Date()));
  app = await createApplication({ databaseUrl, jwtSecret: secret, port: 3000, webOrigin: 'http://localhost:5173' });
  await app.init();
  const login = await request(app.getHttpServer()).post('/api/identity/login').send({ email: adminEmail, password }).expect(200);
  adminToken = login.body.accessToken;
});
afterAll(async () => {
  if (app) await app.close();
  await users.onModuleDestroy();
  await db.query('DELETE FROM identity.users WHERE id = ANY($1::uuid[])', [createdIds]);
  await db.end();
});
describe('HTTP + Nest + Prisma + real PostgreSQL', () => {
  it('reports liveness and database readiness', async () => {
    await request(app.getHttpServer()).get('/api/health/live').expect(200);
    await request(app.getHttpServer()).get('/api/health/ready').expect(200);
  });
  it('does not leak secrets in the current profile', async () => {
    const response = await request(app.getHttpServer()).get('/api/identity/me').auth(adminToken, { type: 'bearer' }).expect(200);
    expect(response.body.email).toBe(adminEmail); expect(response.body).not.toHaveProperty('passwordHash');
    expect(response.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer()).get('/api/identity/users').expect(401);
    await request(app.getHttpServer()).get('/api/identity/me').auth(`${adminToken}bad`, { type: 'bearer' }).expect(401);
  });
  it('creates each supported role, persists hashes and denies non-admin access', async () => {
    for (const role of ['STUDENT', 'TEACHER', 'INSTRUCTIONAL_DESIGNER', 'ADMIN']) {
      const email = `${randomUUID()}@example.test`;
      const response = await request(app.getHttpServer()).post('/api/identity/users').auth(adminToken, { type: 'bearer' })
        .send({ email, displayName: `Test ${role}`, password, role }).expect(201);
      createdIds.push(response.body.id);
      expect(response.body.role).toBe(role); expect(response.body).not.toHaveProperty('passwordHash');
      const saved = await users.findByEmail(email);
      expect(saved?.passwordHash).toMatch(/^scrypt\$/); expect(saved?.passwordHash).not.toContain(password);
      const token = (await request(app.getHttpServer()).post('/api/identity/login').send({ email, password }).expect(200)).body.accessToken;
      if (role === 'STUDENT') studentToken = token;
      if (role !== 'ADMIN') {
        await request(app.getHttpServer()).get('/api/identity/users').auth(token, { type: 'bearer' }).expect(403);
        await request(app.getHttpServer()).post('/api/identity/users').auth(token, { type: 'bearer' })
          .send({ email: `${randomUUID()}@example.test`, displayName: 'Forbidden', password, role: 'ADMIN' }).expect(403);
      }
    }
  });
  it('enforces DTO validation and pagination bounds', async () => {
    for (const body of [
      { email: 'invalid', displayName: 'A', password, role: 'ADMIN' },
      { email: `${randomUUID()}@example.test`, displayName: 'A', password: 'short', role: 'ADMIN' },
      { email: `${randomUUID()}@example.test`, displayName: 'A', password, role: 'SUPERADMIN' },
      { email: `${randomUUID()}@example.test`, displayName: 'A', password, role: 'ADMIN', injected: true },
    ]) await request(app.getHttpServer()).post('/api/identity/users').auth(adminToken, { type: 'bearer' }).send(body).expect(400);
    await request(app.getHttpServer()).get('/api/identity/users?limit=101').auth(adminToken, { type: 'bearer' }).expect(400);
    const response = await request(app.getHttpServer()).get('/api/identity/users?limit=2&offset=0').auth(adminToken, { type: 'bearer' }).expect(200);
    expect(response.body).toHaveLength(2); expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });
  it('handles concurrent duplicate creates with a database uniqueness constraint', async () => {
    const body = { email: `${randomUUID()}@example.test`, displayName: 'Concurrent', password, role: 'STUDENT' };
    const responses = await Promise.all([1, 2].map(() => request(app.getHttpServer()).post('/api/identity/users')
      .auth(adminToken, { type: 'bearer' }).send(body)));
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    createdIds.push(responses.find(r => r.status === 201)!.body.id);
  });
  it('reads role changes from persistence instead of trusting JWT roles', async () => {
    const student = await request(app.getHttpServer()).get('/api/identity/me').auth(studentToken, { type: 'bearer' }).expect(200);
    await db.query('UPDATE identity.users SET role = $1 WHERE id = $2', ['TEACHER', student.body.id]);
    const response = await request(app.getHttpServer()).get('/api/identity/me').auth(studentToken, { type: 'bearer' }).expect(200);
    expect(response.body.role).toBe('TEACHER');
    await request(app.getHttpServer()).get('/api/identity/users').auth(studentToken, { type: 'bearer' }).expect(403);
  });
  it('rate-limits login attempts (other tests used the 5-attempt allowance)', async () => {
    await request(app.getHttpServer()).post('/api/identity/login').send({ email: adminEmail, password: 'wrong' }).expect(429);
  });
});
