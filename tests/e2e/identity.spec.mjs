import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { config } from 'dotenv';
import pg from 'pg';
import { verifyCourses } from './course-flow.mjs';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { PrismaUserRepository } = require('../../apps/api/dist/modules/identity/infrastructure/persistence/prisma-user-repository.js');
const { ScryptPasswordHasher } = require('../../apps/api/dist/modules/identity/infrastructure/security/scrypt-password-hasher.js');
const { User } = require('../../apps/api/dist/modules/identity/domain/user.js');
config({ path: new URL('../../.env', import.meta.url), quiet: true });
const url = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/edutrack') throw new Error('E2E requires local Compose edutrack DB');
const password = randomBytes(20).toString('hex'); const adminEmail = `e2e-${randomUUID()}@example.test`; const studentEmail = `e2e-${randomUUID()}@example.test`;
const ids = []; const users = new PrismaUserRepository(process.env.DATABASE_URL, process.env.JWT_SECRET);
let teacher, designer;
test.beforeAll(async () => {
  const user = new User(randomUUID(), adminEmail, 'Administración QA', await new ScryptPasswordHasher().hash(password), 'ADMIN', new Date());
  ids.push(user.id); await users.create(user);
  if (process.env.COURSES_E2E === 'true') {
    teacher = new User(randomUUID(), `e2e-${randomUUID()}@example.test`, 'Docente QA', await new ScryptPasswordHasher().hash(password), 'TEACHER', new Date());
    designer = new User(randomUUID(), `e2e-${randomUUID()}@example.test`, 'Diseño QA', teacher.passwordHash, 'INSTRUCTIONAL_DESIGNER', new Date());
    ids.push(teacher.id, designer.id); await users.create(teacher); await users.create(designer);
  }
});
test.afterAll(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  if (teacher) {
    const files = await pool.query('SELECT v."storageKey" FROM courses.material_versions v JOIN courses.materials m ON m.id=v."materialId" JOIN courses.sessions s ON s.id=m."sessionId" JOIN courses.units u ON u.id=s."unitId" JOIN courses.courses c ON c.id=u."courseId" WHERE c."teacherId"=$1 AND v."storageKey" IS NOT NULL', [teacher.id]);
    const cleanup = `const fs=require('node:fs');const keys=JSON.parse(fs.readFileSync(0,'utf8'));for(const key of keys){if(!/^[a-f0-9-]{36}$/.test(key))throw Error('Invalid fixture key');fs.rmSync('/app/storage/courses/'+key,{force:true});}`;
    const cleaned = spawnSync('docker', ['compose', 'exec', '-T', 'api', 'node', '-e', cleanup], { input: JSON.stringify(files.rows.map(row => row.storageKey)), encoding: 'utf8' });
    if (cleaned.status !== 0) throw new Error('Unable to remove own course fixture files');
    // Projection rows of the QA course are removed; its append-only enrollment run log is kept by design.
    await pool.query('DELETE FROM enrollments.enrollments WHERE "courseId" IN (SELECT id FROM courses.courses WHERE "teacherId"=$1)', [teacher.id]);
    await pool.query('DELETE FROM courses.courses WHERE "teacherId"=$1', [teacher.id]);
  }
  await pool.query('DELETE FROM identity.users WHERE id=ANY($1::uuid[]) OR email=$2', [ids, studentEmail]);
  await pool.end(); await users.onModuleDestroy();
});
test('real browser: identity, recovery and optional academic course workflow', async ({ page, request, browser }) => {
  test.setTimeout(process.env.COURSES_E2E === 'true' ? 300000 : 60000);
  const browserErrors = []; page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto('/'); await page.screenshot({ path: 'tmp/screens/phase2-login.png', fullPage: true });
  await page.getByLabel('Correo institucional').fill(adminEmail); await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: /Ingresar a mi espacio/ }).click(); await expect(page.getByText('Tu centro de administración', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Usuarios y roles', exact: true }).click();
  await page.getByLabel('Nombre completo').fill('Estudiante QA'); await page.getByLabel('Correo institucional').fill(studentEmail);
  await page.getByLabel('Contraseña inicial').fill(password); await page.getByRole('button', { name: /Crear usuario/ }).click();
  await expect(page.getByText('Usuario creado.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar Estudiante QA', exact: true }).click();
  await page.getByLabel('Rol', { exact: true }).selectOption('TEACHER'); await page.getByRole('button', { name: /Guardar cambios/ }).click();
  await expect(page.getByText('Usuario actualizado.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'tmp/screens/phase2-admin.png', fullPage: true });
  await page.getByRole('button', { name: /Editar Estudiante QA/ }).click(); await page.getByLabel('Rol', { exact: true }).selectOption('STUDENT');
  await page.getByRole('button', { name: /Guardar cambios/ }).click(); await expect(page.getByText('Usuario actualizado.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Eventos de seguridad', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Eventos de seguridad' })).toBeVisible();
  await page.getByRole('button', { name: /Cerrar sesión/ }).click(); await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  await page.getByLabel('Correo institucional').fill(studentEmail); await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: /Ingresar a mi espacio/ }).click(); await expect(page.getByText('Tu espacio de aprendizaje', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usuarios y roles', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mi perfil y seguridad', exact: true }).click(); await page.getByLabel('Nombre completo').fill('Estudiante actualizado');
  await page.getByRole('button', { name: /Guardar perfil/ }).click(); await expect(page.getByText('Perfil actualizado.', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'tmp/screens/phase2-profile-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /Cerrar sesión/ }).click(); await page.getByRole('button', { name: 'Olvidé mi contraseña' }).click();
  await page.getByLabel('Correo institucional').fill(studentEmail); await page.getByRole('button', { name: /Solicitar enlace/ }).click();
  await expect(page.getByRole('status')).toContainText('Si la cuenta está activa');
  let mailId;
  await expect.poll(async () => {
    const result = await (await request.get('http://localhost:8025/api/v1/messages')).json();
    mailId = result.messages.find(message => message.To.some(to => to.Address === studentEmail))?.ID; return !!mailId;
  }, { timeout: 15000 }).toBe(true);
  const message = await (await request.get(`http://localhost:8025/api/v1/message/${mailId}`)).json();
  const link = message.Text.match(/https:\/\/localhost:8443\/#reset=[a-f0-9]{64}/)?.[0]; expect(link).toBeTruthy();
  await page.goto(link); await expect(page.getByLabel('Nueva contraseña', { exact: true })).toBeVisible(); expect(page.url()).not.toContain('#reset');
  await page.getByLabel('Nueva contraseña', { exact: true }).fill(`${password}new`); await page.getByLabel('Confirma la contraseña').fill(`${password}new`);
  await page.getByRole('button', { name: /Actualizar contraseña/ }).click(); await expect(page.getByRole('status')).toContainText('Contraseña actualizada');
  await page.getByRole('button', { name: /Volver al inicio/ }).click(); await page.getByLabel('Correo institucional').fill(studentEmail);
  await page.getByLabel('Contraseña', { exact: true }).fill(`${password}new`); await page.getByRole('button', { name: /Ingresar a mi espacio/ }).click();
  await expect(page.getByRole('heading', { name: /Hola, Estudiante/ })).toBeVisible(); expect(browserErrors).toEqual([]);
  if (teacher) {
    await verifyCourses({ studentPage: page, browser, teacher, designer, admin: { email: adminEmail }, studentEmail, password });
  }
});
