// Local autosave load measurement (EAC-01/CAR-11) against the DISPOSABLE edutrack_test database and a real HTTP server.
// It measures latency, errors and lost acknowledged answers. It does NOT certify the 3,000-student target: that requires
// a representative environment (replicas, managed PostgreSQL, network). Usage: STUDENTS=200 SAVES=10 npm run test:load
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';
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
const app = await createApplication({ databaseUrl, jwtSecret: secret, port: 0, webOrigin: 'http://localhost:5173', trustProxy: 'loopback', examJobIntervalMs: 500,
  mail: { host: 'localhost', port: 1025, from: 'qa@example.test', secure: false, requireTLS: false, webOrigin: 'http://localhost:5173' }, academic: { storageRoot: path.resolve('../../tmp/load-files') } });
await app.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
let ip = 0;
async function call(method, route, token, body) {
  const response = await fetch(`${base}${route}`, { method, headers: { 'X-Forwarded-For': `10.${(++ip >> 16) & 255}.${(ip >> 8) & 255}.${ip & 255}`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
}
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
const attempts = await pool(studentTokens, 50, async token => (await call('POST', `/exams/assessments/${quiz.id}/attempt`, token, {})).body);

// Measured phase: every student autosaves SAVES times at once (worst case: a whole section in the same second).
const latencies = []; const statuses = {}; const acked = new Map();
const started = performance.now();
await pool(attempts.map((attempt, index) => ({ attempt, token: studentTokens[index] })), CONCURRENCY, async ({ attempt, token }) => {
  for (let version = 1; version <= SAVES; version++) {
    const question = attempt.questions[version % attempt.questions.length]; const optionIds = [question.options[version % question.options.length].id];
    const t0 = performance.now(); const result = await call('PUT', `/exams/attempts/${attempt.id}/answers/${question.questionId}`, token, { optionIds, version });
    latencies.push(performance.now() - t0); statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    if (result.status === 200) acked.set(`${attempt.id}:${question.questionId}`, Math.max(acked.get(`${attempt.id}:${question.questionId}`) ?? 0, result.body.version));
  }
});
const elapsed = (performance.now() - started) / 1000;
// Zero loss of acknowledged answers: every ACKed version is durably stored (equal or newer).
const stored = new Map((await db.query('SELECT "attemptId", "questionId", version FROM exams.answers WHERE "attemptId" = ANY($1::uuid[])', [attempts.map(attempt => attempt.id)]))
  .rows.map(row => [`${row.attemptId}:${row.questionId}`, Number(row.version)]));
const lost = [...acked].filter(([key, version]) => (stored.get(key) ?? 0) < version).length;
const finalizeStart = performance.now();
await pool(attempts.map((attempt, index) => ({ attempt, token: studentTokens[index] })), 50, ({ attempt, token }) => call('POST', `/exams/attempts/${attempt.id}/finalize`, token, {}));
let graded = 0;
for (let wait = 0; wait < 240 && graded < STUDENTS; wait++) { await new Promise(resolve => setTimeout(resolve, 500));
  graded = Number((await db.query('SELECT count(*) FROM grading.grades WHERE "assessmentId"=$1', [quiz.id])).rows[0].count); }
const result = { date: new Date().toISOString(), environment: 'local single process + PostgreSQL 17 (Docker, tmpfs); not representative of production',
  students: STUDENTS, savesPerStudent: SAVES, concurrency: CONCURRENCY, requests: latencies.length, statuses, seconds: Number(elapsed.toFixed(2)),
  throughputPerSecond: Number((latencies.length / elapsed).toFixed(1)),
  latencyMs: { p50: Math.round(percentile(latencies, 50)), p95: Math.round(percentile(latencies, 95)), p99: Math.round(percentile(latencies, 99)), max: Math.round(Math.max(...latencies)) },
  acknowledgedAnswers: acked.size, lostAcknowledged: lost, graded: `${graded}/${STUDENTS}`, gradingDrainSeconds: Number(((performance.now() - finalizeStart) / 1000).toFixed(1)) };
console.log(JSON.stringify(result, null, 2));
await mkdir(path.resolve('../../tmp/load'), { recursive: true }); await writeFile(path.resolve(`../../tmp/load/autosave-${Date.now()}.json`), JSON.stringify(result, null, 2));
await db.query('DELETE FROM enrollments.enrollments WHERE "courseId"=$1', [course.id]); await db.query('DELETE FROM courses.courses WHERE id=$1', [course.id]);
await db.query('DELETE FROM identity.users WHERE id = ANY($1::uuid[])', [ids]);
await app.close(); await users.onModuleDestroy(); await db.end();
process.exitCode = lost === 0 && (statuses[200] ?? 0) === latencies.length && graded === STUDENTS ? 0 : 1;
