// Local autosave load measurement (EAC-01/CAR-11) against the DISPOSABLE edutrack_test database and a real HTTP server.
// It measures latency, errors and lost acknowledged answers. It does NOT certify the 3,000-student target: that requires
// a representative environment (replicas, managed PostgreSQL, network). Usage: STUDENTS=200 SAVES=10 npm run test:load
// Compose mode (Part C): LOAD_BASE_URL=https://localhost:8443/api targets the two API replicas behind Nginx started with
// compose.loadtest.yaml (same disposable database); KILL_REPLICA=api2 kills that container when KILL_AT (0-1) of the
// saves are done and starts it again RESTART_AFTER_MS later. Failed saves are retried like the SPA does (same version).
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { createApplication } = require('../../dist/bootstrap.js');
const { PrismaUserRepository } = require('../../dist/modules/identity/infrastructure/persistence/prisma-user-repository.js');
const { ScryptPasswordHasher } = require('../../dist/modules/identity/infrastructure/security/scrypt-password-hasher.js');
const { User } = require('../../dist/modules/identity/domain/user.js');

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/edutrack_test') throw new Error('Load tests only run against the disposable edutrack_test database');
const STUDENTS = Number(process.env.STUDENTS ?? 200), SAVES = Number(process.env.SAVES ?? 10), CONCURRENCY = Number(process.env.CONCURRENCY ?? STUDENTS);
const password = randomBytes(16).toString('hex'), secret = randomBytes(48).toString('hex');
const users = new PrismaUserRepository(databaseUrl, secret); const db = new pg.Pool({ connectionString: databaseUrl });
const external = process.env.LOAD_BASE_URL;
// The local Compose edge uses a self-signed certificate: validation is disabled only for this local measurement.
if (external?.startsWith('https://localhost')) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const KILL_REPLICA = process.env.KILL_REPLICA, KILL_AT = Number(process.env.KILL_AT ?? 0.5), RESTART_AFTER_MS = Number(process.env.RESTART_AFTER_MS ?? 20000);
if (KILL_REPLICA && !/^api2?$/.test(KILL_REPLICA)) throw new Error('KILL_REPLICA must be api or api2');
const app = external ? null : await createApplication({ databaseUrl, jwtSecret: secret, port: 0, webOrigin: 'http://localhost:5173', trustProxy: 'loopback', examJobIntervalMs: 500,
  mail: { host: 'localhost', port: 1025, from: 'qa@example.test', secure: false, requireTLS: false, webOrigin: 'http://localhost:5173' }, academic: { storageRoot: path.resolve('../../tmp/load-files') } });
if (app) await app.listen(0, '127.0.0.1');
const base = external ?? `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
const compose = args => execFileSync('docker', ['compose', '-f', 'compose.yaml', '-f', 'compose.loadtest.yaml', ...args], { cwd: path.resolve('../..'), stdio: 'pipe' }).toString();
const timeline = []; const mark = event => timeline.push({ atSeconds: Number(((performance.now() - (globalThis.measureStart ?? performance.now())) / 1000).toFixed(2)), event });
let ip = 0;
async function call(method, route, token, body) {
  const response = await fetch(`${base}${route}`, { method, headers: { 'X-Forwarded-For': `10.${(++ip >> 16) & 255}.${(ip >> 8) & 255}.${ip & 255}`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text(); let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: response.status, body: parsed };
}
/** Network errors during a replica failure surface as status 0 instead of aborting the run. */
async function safeCall(...args) { try { return await call(...args); } catch { return { status: 0, body: null }; } }
async function pool(items, limit, work) { const out = []; let next = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i], i); } })); return out; }
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1)] ?? 0; };

const hash = await new ScryptPasswordHasher().hash(password); const ids = [];
async function account(role, name) { const user = new User(randomUUID(), `load-${randomUUID()}@example.test`, name, hash, role, new Date()); await users.create(user); ids.push(user.id); return user; }
const staff = { teacher: await account('TEACHER', 'Load teacher'), designer: await account('INSTRUCTIONAL_DESIGNER', 'Load designer'), admin: await account('ADMIN', 'Load admin') };
const students = await pool(Array.from({ length: STUDENTS }), 20, (_, index) => account('STUDENT', `Load student ${index}`));
const login = async user => (await call('POST', '/identity/login', null, { email: user.email, password })).body.accessToken;
const tokens = Object.fromEntries(await Promise.all(Object.entries(staff).map(async ([name, user]) => [name, await login(user)])));
const studentTokens = await pool(students, 4, login); // scrypt (~128 MiB per derivation) bounds login concurrency

let course = (await call('POST', '/courses', tokens.teacher, { code: `LOAD-${randomUUID().slice(0, 6)}`, name: 'Carga', description: 'Carga', period: '2026-II', teacherId: staff.teacher.id })).body;
course = (await call('PATCH', `/courses/${course.id}`, tokens.teacher, { code: course.code, name: course.name, description: course.description, period: course.period, teacherId: course.teacherId, syllabus: 'S', revision: course.revision })).body;
course = (await call('POST', `/courses/${course.id}/units`, tokens.teacher, { title: 'U', revision: course.revision })).body;
course = (await call('POST', `/courses/${course.id}/units/${course.units[0].id}/sessions`, tokens.teacher, { title: 'S', description: '', revision: course.revision })).body;
course = (await call('POST', `/courses/${course.id}/sessions/${course.units[0].sessions[0].id}/materials`, tokens.teacher, { title: 'M', kind: 'LINK', url: 'https://example.test', revision: course.revision })).body;
course = (await call('POST', `/courses/${course.id}/transitions`, tokens.teacher, { decision: 'SUBMITTED', observations: '', revision: course.revision })).body;
course = (await call('POST', `/courses/${course.id}/transitions`, tokens.designer, { decision: 'APPROVED', observations: '', revision: course.revision })).body;
await call('POST', `/enrollments/courses/${course.id}/roster`, tokens.admin, { emails: students.map(student => student.email) });
const [bank] = (await call('POST', `/assessments/courses/${course.id}/banks`, tokens.teacher, { name: 'Banco carga' })).body;
for (let index = 0; index < 20; index++) await call('POST', `/assessments/banks/${bank.id}/questions`, tokens.teacher,
  { type: 'MULTIPLE', statement: `Pregunta ${index}`, points: 1, options: [{ text: 'A', correct: true }, { text: 'B', correct: false }, { text: 'C', correct: true }, { text: 'D', correct: false }] });
let quiz = (await call('POST', `/assessments/courses/${course.id}`, tokens.teacher, { title: 'Carga', instructions: '', type: 'QUIZ', weight: 10, dueAt: new Date(Date.now() + 3_600_000).toISOString(), durationMinutes: 60, questionCount: 10, bankId: bank.id })).body;
quiz = (await call('POST', `/assessments/${quiz.id}/publish`, tokens.teacher, { revision: 0 })).body;
const attempts = await pool(studentTokens, 50, async token => {
  const started = await call('POST', `/exams/assessments/${quiz.id}/attempt`, token, {});
  if (started.status >= 300 || !started.body?.questions) throw new Error(`Setup failed: start attempt HTTP ${started.status} ${JSON.stringify(started.body)?.slice(0, 200)} (quiz ${quiz?.status ?? JSON.stringify(quiz).slice(0, 120)}, token ${token ? 'ok' : 'missing'})`);
  return started.body;
});

// Measured phase: every student autosaves SAVES times at once (worst case: a whole section in the same second).
const latencies = []; const statuses = {}; const firstTry = {}; const acked = new Map(); let retried = 0, done = 0, killed = false, restartTimer = null;
const total = STUDENTS * SAVES;
const started = performance.now(); globalThis.measureStart = started;
function maybeKill() {
  if (!KILL_REPLICA || killed || done < total * KILL_AT) return;
  killed = true; mark(`kill ${KILL_REPLICA}`);
  try { compose(['kill', KILL_REPLICA]); } catch (error) { mark(`kill failed: ${error.message}`); }
  restartTimer = setTimeout(() => { mark(`start ${KILL_REPLICA}`); try { compose(['start', KILL_REPLICA]); } catch (error) { mark(`start failed: ${error.message}`); } }, RESTART_AFTER_MS);
}
await pool(attempts.map((attempt, index) => ({ attempt, token: studentTokens[index] })), CONCURRENCY, async ({ attempt, token }) => {
  for (let version = 1; version <= SAVES; version++) {
    const question = attempt.questions[version % attempt.questions.length]; const optionIds = [question.options[version % question.options.length].id];
    const t0 = performance.now(); let result = await safeCall('PUT', `/exams/attempts/${attempt.id}/answers/${question.questionId}`, token, { optionIds, version });
    firstTry[result.status] = (firstTry[result.status] ?? 0) + 1;
    // Like the SPA queue: resend the same version until acknowledged (idempotent by version).
    for (let retry = 0; retry < 5 && result.status !== 200 && result.status !== 409; retry++) {
      retried++; await new Promise(resolve => setTimeout(resolve, 250 * 2 ** retry));
      result = await safeCall('PUT', `/exams/attempts/${attempt.id}/answers/${question.questionId}`, token, { optionIds, version });
    }
    latencies.push(performance.now() - t0); statuses[result.status] = (statuses[result.status] ?? 0) + 1; done++; maybeKill();
    if (result.status === 200) acked.set(`${attempt.id}:${question.questionId}`, Math.max(acked.get(`${attempt.id}:${question.questionId}`) ?? 0, result.body.version));
  }
});
const elapsed = (performance.now() - started) / 1000;
if (restartTimer) { await new Promise(resolve => setTimeout(resolve, Math.max(0, RESTART_AFTER_MS - (performance.now() - started)))); }
if (KILL_REPLICA) {
  // Recovery: time until the restarted replica answers its readiness probe again (EAC-02 objective: <= 300 s).
  const restartAt = performance.now(); let healthy = false;
  for (let wait = 0; wait < 300 && !healthy; wait++) {
    try { healthy = compose(['ps', '--format', '{{.Service}} {{.Health}}', KILL_REPLICA]).includes('healthy') && !compose(['ps', '--format', '{{.Health}}', KILL_REPLICA]).includes('unhealthy'); } catch { healthy = false; }
    if (!healthy) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  mark(healthy ? `${KILL_REPLICA} healthy again after ${((performance.now() - restartAt) / 1000).toFixed(1)} s from the end of the measured phase` : `${KILL_REPLICA} not healthy after 300 s`);
}
// Zero loss of acknowledged answers: every ACKed version is durably stored (equal or newer).
const stored = new Map((await db.query('SELECT "attemptId", "questionId", version FROM exams.answers WHERE "attemptId" = ANY($1::uuid[])', [attempts.map(attempt => attempt.id)]))
  .rows.map(row => [`${row.attemptId}:${row.questionId}`, Number(row.version)]));
const lost = [...acked].filter(([key, version]) => (stored.get(key) ?? 0) < version).length;
const finalizeStart = performance.now();
await pool(attempts.map((attempt, index) => ({ attempt, token: studentTokens[index] })), 50, async ({ attempt, token }) => {
  for (let retry = 0; retry < 5; retry++) { if ((await safeCall('POST', `/exams/attempts/${attempt.id}/finalize`, token, {})).status === 200) return; await new Promise(resolve => setTimeout(resolve, 500)); }
});
let graded = 0;
for (let wait = 0; wait < 240 && graded < STUDENTS; wait++) { await new Promise(resolve => setTimeout(resolve, 500));
  graded = Number((await db.query('SELECT count(*) FROM grading.grades WHERE "assessmentId"=$1', [quiz.id])).rows[0].count); }
const result = { date: new Date().toISOString(), environment: external ? `Compose: Nginx HTTPS + 2 API replicas (Docker Desktop) + PostgreSQL 17 test DB (Docker, tmpfs); ${KILL_REPLICA ? `${KILL_REPLICA} killed at ${KILL_AT * 100}% of the saves` : 'no failure injected'}; not representative of production`
    : 'local single process + PostgreSQL 17 (Docker, tmpfs); not representative of production',
  students: STUDENTS, savesPerStudent: SAVES, concurrency: CONCURRENCY, requests: latencies.length, statuses, firstTryStatuses: firstTry, clientRetries: retried, timeline, seconds: Number(elapsed.toFixed(2)),
  throughputPerSecond: Number((latencies.length / elapsed).toFixed(1)),
  latencyMs: { p50: Math.round(percentile(latencies, 50)), p95: Math.round(percentile(latencies, 95)), p99: Math.round(percentile(latencies, 99)), max: Math.round(Math.max(...latencies)) },
  acknowledgedAnswers: acked.size, lostAcknowledged: lost, graded: `${graded}/${STUDENTS}`, gradingDrainSeconds: Number(((performance.now() - finalizeStart) / 1000).toFixed(1)) };
console.log(JSON.stringify(result, null, 2));
await mkdir(path.resolve('../../tmp/load'), { recursive: true }); await writeFile(path.resolve(`../../tmp/load/autosave-${Date.now()}.json`), JSON.stringify(result, null, 2));
await db.query('DELETE FROM enrollments.enrollments WHERE "courseId"=$1', [course.id]); await db.query('DELETE FROM courses.courses WHERE id=$1', [course.id]);
await db.query('DELETE FROM identity.users WHERE id = ANY($1::uuid[])', [ids]);
await app?.close(); await users.onModuleDestroy(); await db.end();
process.exitCode = lost === 0 && (statuses[200] ?? 0) === latencies.length && graded === STUDENTS ? 0 : 1;
