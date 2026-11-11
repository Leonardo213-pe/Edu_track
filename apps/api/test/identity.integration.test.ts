import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createApplication } from '../dist/bootstrap.js';
import { PrismaUserRepository } from '../dist/modules/identity/infrastructure/persistence/prisma-user-repository.js';
import { ScryptPasswordHasher } from '../dist/modules/identity/infrastructure/security/scrypt-password-hasher.js';
import { SmtpResetMailer } from '../dist/modules/identity/infrastructure/notifications/smtp-reset-mailer.js';
import { RecoveryCipher } from '../dist/modules/identity/infrastructure/security/recovery-cipher.js';
import { User } from '../dist/modules/identity/domain/user.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/edutrack_test') throw new Error('TEST_DATABASE_URL must target disposable edutrack_test; no fallback');
const secret = randomBytes(48).toString('hex'), password = randomBytes(16).toString('hex');
const users = new PrismaUserRepository(databaseUrl, secret), db = new Pool({ connectionString: databaseUrl });
const mail = { host: 'localhost', port: Number(process.env.TEST_SMTP_PORT ?? 1025), from: 'EduTrack <noreply@edutrack.test>',
  secure: false, requireTLS: false, webOrigin: 'http://localhost:5173' };
let app: Awaited<ReturnType<typeof createApplication>>, adminToken: string, studentToken: string;
let admin: User, student: User, hash: string;
let createdIds: string[] = [];
beforeAll(async () => { hash = await new ScryptPasswordHasher().hash(password); });
beforeEach(async () => {
  admin = new User(randomUUID(), `${randomUUID()}@example.test`, 'Admin test', hash, 'ADMIN', new Date());
  student = new User(randomUUID(), `${randomUUID()}@example.test`, 'Estudiante test', hash, 'STUDENT', new Date());
  createdIds = [admin.id, student.id]; await users.create(admin); await users.create(student);
  app = await createApplication({ databaseUrl, jwtSecret: secret, port: 3000, webOrigin: mail.webOrigin, mail }); await app.init();
  adminToken = (await login(admin.email)).body.accessToken;
  studentToken = '';
});
afterEach(async () => {
  await app?.close(); await db.query('DELETE FROM identity.users WHERE id = ANY($1::uuid[])', [createdIds]);
});
afterAll(async () => { await users.onModuleDestroy(); await db.end(); });
function login(email: string, suppliedPassword = password) { return request(app.getHttpServer()).post('/api/identity/login').send({ email, password: suppliedPassword }); }
function get(path: string, token = adminToken) { return request(app.getHttpServer()).get(`/api/identity/${path}`).auth(token, { type: 'bearer' }); }
function post(path: string, body: unknown, token = adminToken) { return request(app.getHttpServer()).post(`/api/identity/${path}`).auth(token, { type: 'bearer' }).send(body); }
function patch(id: string, body: unknown, token = adminToken) { return request(app.getHttpServer()).patch(`/api/identity/users/${id}`).auth(token, { type: 'bearer' }).send(body); }
async function create(role = 'STUDENT') {
  const response = await post('users', { email: `${randomUUID()}@example.test`, displayName: `Test ${role}`, password, role }).expect(201);
  createdIds.push(response.body.id); return response.body;
}
describe('phase 2: HTTP, compiled Nest, Prisma, PostgreSQL and SMTP', () => {
  it('checks readiness, safe profile and strict unauthorized access', async () => {
    await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    const response = await get('me').expect(200); expect(response.body).not.toHaveProperty('passwordHash'); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.permissions).toContain('users:write');
    await request(app.getHttpServer()).get('/api/identity/users').expect(401);
    await get('me', `${adminToken}bad`).expect(401);
    const noSession = await db.query('SELECT id FROM identity.sessions WHERE "userId"=$1', [admin.id]);
    await db.query('UPDATE identity.sessions SET "expiresAt"=now()-interval \'1 second\' WHERE id=$1', [noSession.rows[0].id]); await get('me').expect(401);
  });
  it('rejects wrong/unknown credentials and a deactivated account consistently', async () => {
    const wrong = await login(student.email, 'wrong').expect(401); const unknown = await login('unknown@example.test', 'wrong').expect(401); expect(wrong.body).toEqual(unknown.body);
    await patch(student.id, { ...student.profile(), active: false, permissions: undefined, id: undefined, createdAt: undefined }).expect(200);
    expect((await login(student.email).expect(401)).body).toEqual(wrong.body);
  });
  it('supports all four roles and denies every non-admin role on all management routes', async () => {
    for (const role of ['STUDENT', 'TEACHER', 'INSTRUCTIONAL_DESIGNER', 'ADMIN']) {
      const profile = await create(role); const token = (await login(profile.email).expect(200)).body.accessToken;
      expect((await users.findById(profile.id))?.passwordHash).toMatch(/^scrypt\$/);
      if (role !== 'ADMIN') {
        await get('users', token).expect(403); await get('security-events', token).expect(403);
        await post('users', { email: 'forbidden@example.test', displayName: 'X', password, role: 'ADMIN' }, token).expect(403);
        await patch(profile.id, { email: profile.email, displayName: 'X', role: 'ADMIN', active: true, version: 0 }, token).expect(403);
      }
    }
  });
  it('validates fields, UUIDs and pagination, preventing profile role injection', async () => {
    for (const body of [
      { email: 'bad', displayName: 'A', password, role: 'ADMIN' },
      { email: 'a@example.test', displayName: 'A', password: 'short', role: 'ADMIN' },
      { email: 'a@example.test', displayName: 'A', password, role: 'SUPERADMIN' },
      { email: 'a@example.test', displayName: 'A', password, role: 'ADMIN', injected: true },
    ]) await post('users', body).expect(400);
    await get('users?limit=101').expect(400); await patch('bad-id', {}).expect(400);
    await request(app.getHttpServer()).patch('/api/identity/me').auth(adminToken, { type: 'bearer' }).send({ displayName: 'X', version: 0, role: 'ADMIN' }).expect(400);
    expect((await get('users?limit=1').expect(200)).body).toHaveLength(1);
  });
  it('persists edits and refuses stale versions and duplicate emails', async () => {
    const body = { email: student.email, displayName: 'Actualizado', role: 'STUDENT', active: true, version: 0 };
    const response = await patch(student.id, body).expect(200); expect(response.body.version).toBe(1);
    expect((await users.findById(student.id))?.displayName).toBe('Actualizado');
    await patch(student.id, body).expect(409); await patch(student.id, { ...body, email: admin.email, version: 1 }).expect(409);
    expect((await users.findById(student.id))?.version).toBe(1);
  });
  it('revokes sessions on logout, role changes and deactivation, including after reactivation', async () => {
    studentToken = (await login(student.email)).body.accessToken;
    await post('logout', {}, studentToken).expect(204); await get('me', studentToken).expect(401);
    studentToken = (await login(student.email)).body.accessToken;
    const body = { email: student.email, displayName: student.displayName, role: 'TEACHER', active: true, version: 0 };
    await patch(student.id, body).expect(200); await get('me', studentToken).expect(401);
    studentToken = (await login(student.email)).body.accessToken;
    await patch(student.id, { ...body, active: false, version: 1 }).expect(200); await get('me', studentToken).expect(401);
    await patch(student.id, { ...body, active: true, version: 2 }).expect(200); await get('me', studentToken).expect(401);
  });
  it('protects the last administrator even under concurrent demotions', async () => {
    const body = { email: admin.email, displayName: admin.displayName, role: 'STUDENT', active: true, version: 0 };
    await patch(admin.id, body).expect(409); await patch(admin.id, { ...body, role: 'ADMIN', active: false }).expect(409);
    const other = await create('ADMIN'); const otherToken = (await login(other.email)).body.accessToken;
    const responses = await Promise.all([patch(admin.id, body), patch(other.id, { ...body, email: other.email }, otherToken)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]); expect(await users.countActiveAdmins()).toBe(1);
  });
  it('handles concurrent duplicate creates with PostgreSQL uniqueness', async () => {
    const body = { email: `${randomUUID()}@example.test`, displayName: 'Concurrent', password, role: 'STUDENT' };
    const responses = await Promise.all([post('users', body), post('users', body)]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]); createdIds.push(responses.find(response => response.status === 201)!.body.id);
  });
  it('changes a password, requires the old password and revokes all existing sessions', async () => {
    studentToken = (await login(student.email)).body.accessToken;
    await post('password/change', { currentPassword: 'wrong', newPassword: `${password}new` }, studentToken).expect(400);
    await post('password/change', { currentPassword: password, newPassword: `${password}new` }, studentToken).expect(204);
    await get('me', studentToken).expect(401); await login(student.email).expect(401); await login(student.email, `${password}new`).expect(200);
  });
  it('sends a real SMTP recovery email, stores no plaintext token, consumes it once and revokes sessions', async () => {
    studentToken = (await login(student.email)).body.accessToken;
    const response = await post('password/recovery', { email: student.email }).expect(202);
    const unknown = await post('password/recovery', { email: `${randomUUID()}@example.test` }).expect(202); expect(response.body).toEqual(unknown.body);
    await post('password/recovery', { email: student.email }).expect(202);
    const rows = await db.query('SELECT payload FROM identity.recovery_messages WHERE "userId"=$1', [student.id]); expect(rows.rowCount).toBe(1);
    const message = new RecoveryCipher(secret).open(rows.rows[0].payload); expect(rows.rows[0].payload).not.toContain(message.token);
    const recovery = await db.query('SELECT "tokenHash" FROM identity.password_recoveries WHERE "userId"=$1', [student.id]); expect(recovery.rows[0].tokenHash).not.toBe(message.token);
    await users.dispatchRecovery(new SmtpResetMailer(mail));
    const mailApi = process.env.TEST_MAIL_API ?? 'http://localhost:8025';
    const messages = await (await fetch(`${mailApi}/api/v1/messages`)).json() as { messages: { ID: string; To: { Address: string }[] }[] };
    const sent = messages.messages.find(message => message.To.some(to => to.Address === student.email)); expect(sent).toBeDefined();
    const delivered = await (await fetch(`${mailApi}/api/v1/message/${sent!.ID}`)).json() as { Text: string };
    expect(delivered.Text).toContain(`/#reset=${message.token}`);
    await post('password/reset', { token: message.token, password: `${password}new` }).expect(204);
    await post('password/reset', { token: message.token, password: `${password}newer` }).expect(400);
    await get('me', studentToken).expect(401); await login(student.email, `${password}new`).expect(200);
  });
  it('rejects expired recovery links and atomically consumes competing resets', async () => {
    await post('password/recovery', { email: student.email }).expect(202);
    const row = await db.query('SELECT payload FROM identity.recovery_messages WHERE "userId"=$1', [student.id]); const message = new RecoveryCipher(secret).open(row.rows[0].payload);
    await db.query('UPDATE identity.password_recoveries SET "expiresAt"=now()-interval \'1 second\' WHERE "userId"=$1', [student.id]);
    await post('password/reset', { token: message.token, password: `${password}new` }).expect(400);
    await db.query('UPDATE identity.password_recoveries SET "expiresAt"=now()+interval \'5 minutes\' WHERE "userId"=$1', [student.id]);
    const responses = await Promise.all([post('password/reset', { token: message.token, password: `${password}new` }), post('password/reset', { token: message.token, password: `${password}new` })]);
    expect(responses.map(response => response.status).sort()).toEqual([204, 400]);
  });
  it('retains failed SMTP deliveries for retry and logs the failure without credentials', async () => {
    await post('password/recovery', { email: student.email }).expect(202);
    await users.dispatchRecovery(new SmtpResetMailer({ ...mail, port: 1 }));
    const row = await db.query('SELECT attempts, "deliveredAt" FROM identity.recovery_messages WHERE "userId"=$1', [student.id]);
    expect(row.rows[0]).toMatchObject({ attempts: 1, deliveredAt: null });
    const events = (await get('security-events?limit=100').expect(200)).body;
    expect(events.some((event: { action: string }) => event.action === 'RECOVERY_DELIVERY_FAILED')).toBe(true);
    expect(JSON.stringify(events)).not.toContain(password);
  });
  it('records append-only security events and rate-limits failed login', async () => {
    for (let i = 0; i < 4; i++) await login(student.email, 'wrong').expect(401);
    await login(student.email, 'wrong').expect(429);
    const response = await get('security-events?limit=100').expect(200); const event = response.body.find((event: { userId: string }) => event.userId === admin.id);
    await expect(db.query('UPDATE identity.security_events SET action=$1 WHERE id=$2', ['MODIFIED', event.id])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM identity.security_events WHERE id=$1', [event.id])).rejects.toThrow('append-only');
  });
});
