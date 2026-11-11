// Running Compose (HTTPS edge + 2 API replicas + PostgreSQL). Creates and removes only its own users.
// The local certificate is self-signed: certificate validation is disabled for this local check only.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { config } from 'dotenv';
import pg from 'pg';
import tls from 'node:tls';
config({ path: new URL('../../../.env', import.meta.url), quiet: true });
const database = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname) && database.pathname === '/edutrack', 'Smoke requires local edutrack DB');
const base = `https://localhost:${process.env.WEB_TLS_PORT ?? 8443}`;
const plain = `http://localhost:${process.env.WEB_PORT ?? 8080}`;
function handshake(maxVersion) {
  return new Promise(resolve => {
    const socket = tls.connect({ host: 'localhost', port: Number(process.env.WEB_TLS_PORT ?? 8443), rejectUnauthorized: false, minVersion: 'TLSv1', maxVersion,
      servername: 'localhost' }, () => { const protocol = socket.getProtocol(); socket.end(); resolve(protocol); });
    socket.on('error', () => resolve(null));
  });
}
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
  assert.match(home.headers.get('strict-transport-security') ?? '', /max-age=/);
  const redirect = await fetch(plain, { redirect: 'manual' }); assert.equal(redirect.status, 301); assert.match(redirect.headers.get('location') ?? '', /^https:/);
  assert.equal(await handshake('TLSv1.1'), null, 'TLS 1.1 must be rejected'); assert.equal(await handshake('TLSv1.2'), 'TLSv1.2');
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
  // Part C: both replicas report heartbeats, the registry is the SIMULATED one, audit anchors match the database.
  let monitoring;
  for (let i = 0; i < 20; i++) { monitoring = await call('administration/monitoring?minutes=5', session.accessToken); if (monitoring.replicas.filter(r => r.alive).length >= 2) break; await new Promise(r => setTimeout(r, 1000)); }
  assert.deepEqual(monitoring.replicas.filter(r => r.alive).map(r => r.id).sort(), ['api-1', 'api-2']);
  assert.ok(monitoring.routes.length > 0, 'request metrics are recorded');
  const registry = await call('enrollments/registry', session.accessToken); assert.equal(registry.registry.simulated, true);
  const anchors = await call('audit/anchors/verify', session.accessToken); assert.equal(anchors.configured, true); assert.equal(anchors.valid, true);
  // The runtime database role cannot rewrite the audit log (privileges, before any trigger).
  const appDb = new URL(process.env.DATABASE_URL); appDb.username = 'edutrack_app'; appDb.password = process.env.APP_DB_PASSWORD ?? '';
  const app = new pg.Client({ connectionString: appDb.toString() }); await app.connect();
  try {
    await assert.rejects(app.query('UPDATE audit.entries SET "actorId" = "actorId" WHERE false'), /permission denied/);
    await assert.rejects(app.query('DELETE FROM audit.entries WHERE false'), /permission denied/);
    await assert.rejects(app.query('CREATE TABLE identity.smoke_probe (id int)'), /permission denied/);
  } finally { await app.end(); }
  // Last check (it consumes this client's login quota for one minute): Nginx overwrites X-Forwarded-For, so spoofing does not bypass the limit.
  const attempt = forwarded => fetch(`${base}/api/identity/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwarded },
    body: JSON.stringify({ email: `nobody-${randomUUID()}@example.test`, password: 'wrong-password' }) });
  let limited = false;
  // The limiter is in memory per replica (2 replicas behind Nginx): up to 2×5 attempts may pass before a 429.
  for (let i = 0; i < 14 && !limited; i++) limited = (await attempt(`203.0.113.${i}`)).status === 429;
  assert.ok(limited, 'login attempts are limited per real client even with spoofed X-Forwarded-For');
  console.log('Compose smoke passed: HTTPS (TLS 1.2+, HTTP redirect, HSTS), SPA, readiness, login, profile, user creation/list, role denial, server logout, roster denial, 2 replicas with metrics, SIMULATED registry, audit anchors, least-privilege DB role and proxy-aware rate limit.');
} finally {
  await pool.query('DELETE FROM identity.users WHERE id = ANY($1::uuid[])', [ids]);
  await pool.end();
}
