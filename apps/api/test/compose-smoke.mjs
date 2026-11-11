// Running Compose HTTP + PostgreSQL. Creates and removes only its own users.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { config } from 'dotenv';
import pg from 'pg';
config({ path: new URL('../../../.env', import.meta.url), quiet: true });
const database = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname) && database.pathname === '/edutrack', 'Smoke requires local edutrack DB');
const base = `http://localhost:${process.env.WEB_PORT ?? 8080}`;
const ids = [];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const email = `smoke-${randomUUID()}@example.test`;
const password = randomBytes(24).toString('hex');
const require = createRequire(import.meta.url);
const { PrismaUserRepository } = require('../dist/modules/identity/infrastructure/persistence/prisma-user-repository.js');
const { ScryptPasswordHasher } = require('../dist/modules/identity/infrastructure/security/scrypt-password-hasher.js');
const { User } = require('../dist/modules/identity/domain/user.js');
async function call(path, token, body, expected = 200) {
  const response = await fetch(`${base}/api/${path}`, { method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal(response.status, expected, `${path}: unexpected HTTP status`);
  return response.json();
}
try {
  const home = await fetch(base); assert.equal(home.status, 200); assert.match(await home.text(), /EduTrack/);
  await call('health/ready');
  const repository = new PrismaUserRepository(process.env.DATABASE_URL, process.env.JWT_SECRET);
  const admin = new User(randomUUID(), email, 'Smoke admin', await new ScryptPasswordHasher().hash(password), 'ADMIN', new Date());
  ids.push(admin.id);
  try { await repository.create(admin); } finally { await repository.onModuleDestroy(); }
  const session = await call('identity/login', undefined, { email, password });
  assert.equal(session.user.id, admin.id); assert.equal(session.user.role, 'ADMIN');
  const profile = await call('identity/me', session.accessToken); assert.equal(profile.email, email);
  assert.ok(!('passwordHash' in profile));
  const newEmail = `smoke-${randomUUID()}@example.test`;
  const student = await call('identity/users', session.accessToken,
    { email: newEmail, displayName: 'Smoke student', role: 'STUDENT', password }, 201); ids.push(student.id);
  const students = await call('identity/users?limit=100&offset=0', session.accessToken);
  assert.ok(students.some(user => user.id === student.id));
  const studentSession = await call('identity/login', undefined, { email: newEmail, password });
  await call('identity/users', studentSession.accessToken, undefined, 403);
  const logout = await fetch(`${base}/api/identity/logout`, { method: 'POST', headers: { Authorization: `Bearer ${studentSession.accessToken}` } });
  assert.equal(logout.status, 204); await call('identity/me', studentSession.accessToken, undefined, 401);
  const enrollmentDenied = await fetch(`${base}/api/enrollments/courses/${randomUUID()}/roster`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await call('identity/login', undefined, { email: newEmail, password })).accessToken}` }, body: JSON.stringify({ emails: [] }) });
  assert.equal(enrollmentDenied.status, 403, 'students cannot replace an official roster');
  // Last check (it consumes this client's login quota for one minute): Nginx overwrites X-Forwarded-For, so spoofing does not bypass the limit.
  const attempt = forwarded => fetch(`${base}/api/identity/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwarded },
    body: JSON.stringify({ email: `nobody-${randomUUID()}@example.test`, password: 'wrong-password' }) });
  let limited = false;
  for (let i = 0; i < 8 && !limited; i++) limited = (await attempt(`203.0.113.${i}`)).status === 429;
  assert.ok(limited, 'login attempts are limited per real client even with spoofed X-Forwarded-For');
  console.log('Compose smoke passed: SPA, readiness, login, profile, user creation/list, role denial, server logout, roster denial and proxy-aware rate limit.');
} finally {
  await pool.query('DELETE FROM identity.users WHERE id = ANY($1::uuid[])', [ids]);
  await pool.end();
}
