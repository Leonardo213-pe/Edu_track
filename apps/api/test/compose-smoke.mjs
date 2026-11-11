// Real CLI + running Compose HTTP + PostgreSQL. Creates and removes only its own users.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  const provision = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/modules/identity/infrastructure/cli/create-user.js', import.meta.url)),
    email, 'Smoke admin', 'ADMIN'], { input: password, encoding: 'utf8', env: process.env });
  assert.equal(provision.status, 0, 'CLI provisioning failed');
  const admin = JSON.parse(provision.stdout.trim()); ids.push(admin.id);
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
  console.log('Compose smoke passed: SPA, readiness, CLI, login, profile, user creation/list and role denial.');
} finally {
  await pool.query('DELETE FROM identity.users WHERE id = ANY($1::uuid[])', [ids]);
  await pool.end();
}
