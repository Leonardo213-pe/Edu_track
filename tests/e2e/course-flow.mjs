import { expect } from '@playwright/test';
export async function verifyCourses({ studentPage, browser, teacher, designer, admin, studentEmail, password }) {
  async function signIn(page, email) {
    await page.goto('/'); await page.getByLabel('Correo institucional').fill(email); await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: /Ingresar a mi espacio/ }).click(); await expect(page.getByRole('button', { name: /Cerrar sesión/ })).toBeVisible();
  }
  const code = `E2E-${teacher.id.slice(0, 6)}`.toUpperCase();
  const context = await browser.newContext(); const page = await context.newPage(); await signIn(page, teacher.email);
  await page.getByRole('button', { name: 'Cursos', exact: true }).click(); await page.getByRole('button', { name: /Crear curso/ }).click();
  await page.getByLabel('Código del curso').fill(code); await page.getByLabel('Período académico').fill('2026-II'); await page.getByLabel('Nombre del curso').fill('Curso académico QA');
  await page.getByLabel('Descripción del curso').fill('Contenido real para verificar la experiencia académica.'); await page.getByRole('button', { name: /Crear borrador/ }).click();
  await page.getByRole('button', { name: 'Sílabo', exact: true }).click(); await page.getByLabel('Editar sílabo').fill('Resultados de aprendizaje, unidades y metodología.');
  await page.getByRole('button', { name: /Guardar sílabo/ }).click(); await expect(page.getByRole('status')).toHaveText('Cambios guardados.');
  await page.getByRole('button', { name: 'Contenido', exact: true }).click(); await page.getByLabel('Nombre de la nueva unidad').fill('Primera unidad'); await page.getByRole('button', { name: /Crear unidad/ }).click();
  // A unit created by mistake in a never-published draft can be removed.
  await page.getByLabel('Nombre de la nueva unidad').fill('Unidad equivocada'); await page.getByRole('button', { name: /Crear unidad/ }).click();
  await expect(page.getByRole('heading', { name: 'Unidad equivocada' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.course-unit').filter({ hasText: 'Unidad equivocada' }).getByRole('button', { name: 'Eliminar unidad' }).click();
  await expect(page.getByRole('heading', { name: 'Unidad equivocada' })).toHaveCount(0);
  await page.getByText('+ Agregar sesión', { exact: true }).click(); const sessionForm = page.locator('form').filter({ has: page.getByRole('button', { name: /Crear sesión/ }) });
  await sessionForm.getByLabel('Nombre de sesión').fill('Sesión introductoria'); await sessionForm.getByLabel('Duración de la sesión (minutos)').fill('90');
  await sessionForm.getByRole('button', { name: /Crear sesión/ }).click(); await expect(page.getByText(/Duración total: 1 h 30 min/)).toBeVisible();
  await page.getByText('+ Agregar material', { exact: true }).click(); const materialForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Agregar material', exact: false }) });
  await materialForm.getByLabel('Título del material').fill('Lectura inicial');
  await materialForm.locator('input[type=file]').setInputFiles({ name: 'lectura.txt', mimeType: 'text/plain', buffer: Buffer.from('Contenido académico real de la etapa 3.') });
  await materialForm.getByRole('button', { name: /Agregar material/ }).click(); await expect(page.getByRole('heading', { name: 'Lectura inicial' })).toBeVisible();
  await page.getByRole('button', { name: /Enviar a revisión/ }).click(); await expect(page.locator('.course-hero').getByText('En revisión', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Historial', exact: true }).click(); await expect(page.getByRole('cell', { name: 'Unidad eliminada' })).toBeVisible();
  await page.screenshot({ path: 'tmp/screens/phase3-teacher.png', fullPage: true });

  await page.getByRole('button', { name: /Cerrar sesión/ }).click(); await signIn(page, designer.email);
  await page.getByRole('button', { name: 'Revisión de cursos', exact: true }).click(); await page.getByLabel('Buscar cursos').fill(code);
  await page.getByRole('button', { name: /Revisar curso/ }).click(); await page.getByRole('button', { name: /Registrar decisión/ }).click();
  await expect(page.locator('.course-hero').getByText('Publicado', { exact: true })).toBeVisible();

  // The official roster is consumed through the administrator screen; without it the student cannot see the course.
  await studentPage.getByRole('button', { name: 'Mis cursos', exact: true }).click(); await expect(studentPage.getByText(/Aún no estás inscrito/)).toBeVisible();
  // Login is limited to 5 requests/min per client IP and every browser of this test shares one IP: respect the window.
  await page.getByRole('button', { name: /Cerrar sesión/ }).click(); await page.waitForTimeout(61000); await signIn(page, admin.email);
  await page.getByRole('button', { name: 'Cursos', exact: true }).click(); await page.getByLabel('Buscar cursos').fill(code); await page.getByRole('button', { name: /Abrir curso/ }).click();
  await page.getByRole('button', { name: 'Inscritos', exact: true }).click(); await page.getByLabel('Correos de estudiantes inscritos').fill(studentEmail);
  await page.getByRole('button', { name: /Sincronizar lista oficial/ }).click(); await expect(page.getByRole('status')).toHaveText('Lista sincronizada: 1 altas, 0 bajas, 1 inscritos.');
  await page.screenshot({ path: 'tmp/screens/phase3-enrollments.png', fullPage: true });

  await studentPage.getByRole('button', { name: /Recargar/ }).click();
  await studentPage.getByRole('button', { name: /Abrir curso/ }).click(); await studentPage.getByRole('button', { name: /Visualizar/ }).click();
  await expect(studentPage.frameLocator('iframe').locator('body')).toContainText('Contenido académico real'); await studentPage.getByRole('button', { name: /Cerrar visor/ }).click();
  await studentPage.getByRole('button', { name: 'Marcar completado', exact: true }).click(); await expect(studentPage.getByText('100% · 1/1 materiales completados')).toBeVisible();
  await expect(studentPage.getByRole('button', { name: 'Historial', exact: true })).toHaveCount(0);
  await studentPage.setViewportSize({ width: 390, height: 844 }); expect(await studentPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await studentPage.screenshot({ path: 'tmp/screens/phase3-student.png', fullPage: true });
  if (process.env.ASSESSMENTS_E2E === 'true') await verifyAssessments({ page, studentPage, signIn, code, teacher, admin });
  await context.close();
}

/** Phase 4 in a real browser: bank, rubric assessment, publication, grade + audited change, student average and audit log. */
async function verifyAssessments({ page, studentPage, signIn, code, teacher, admin }) {
  await page.getByRole('button', { name: /Cerrar sesión/ }).click(); await signIn(page, teacher.email);
  await page.getByRole('button', { name: 'Cursos', exact: true }).click(); await page.getByLabel('Buscar cursos').fill(code); await page.getByRole('button', { name: /Abrir curso/ }).click();
  await page.getByRole('button', { name: 'Banco de preguntas', exact: true }).click();
  await page.getByLabel('Nombre del banco').fill('Banco QA'); await page.getByRole('button', { name: 'Crear banco' }).click(); await expect(page.getByRole('status')).toHaveText('Banco creado.');
  await page.getByText('+ Agregar pregunta a Banco QA').click(); await page.getByLabel('Tipo de pregunta').selectOption('TRUE_FALSE');
  await page.getByLabel('Enunciado').fill('La arquitectura hexagonal aísla el dominio.'); await page.getByRole('button', { name: /Agregar pregunta/ }).click();
  await expect(page.getByRole('status')).toHaveText('Pregunta agregada.');
  await page.getByRole('button', { name: 'Evaluaciones', exact: true }).click(); await page.getByRole('button', { name: /Nueva evaluación/ }).click();
  const form = page.getByRole('form', { name: 'Nueva evaluación' });
  await form.getByLabel('Título de la evaluación').fill('Ensayo QA'); await form.getByLabel('Tipo de evaluación').selectOption('RUBRIC');
  await form.getByLabel('Peso (%)').fill('60'); await form.getByLabel('Fecha límite').fill('2026-12-15T10:00');
  await form.getByLabel('Criterio 1', { exact: true }).fill('Argumentación'); await form.getByLabel('Puntaje máximo del criterio 1').fill('15');
  await form.getByRole('button', { name: '+ Criterio' }).click(); await form.getByLabel('Criterio 2', { exact: true }).fill('Redacción'); await form.getByLabel('Puntaje máximo del criterio 2').fill('5');
  await form.getByRole('button', { name: /Crear evaluación/ }).click(); await expect(page.getByRole('status')).toHaveText('Evaluación creada en borrador.');
  await page.getByRole('button', { name: 'Publicar', exact: true }).click(); await expect(page.getByRole('status')).toHaveText('Evaluación publicada.');
  await page.getByRole('button', { name: 'Calificaciones', exact: true }).click();
  await page.getByRole('button', { name: 'Calificar Ensayo QA de Estudiante actualizado' }).click();
  await page.getByLabel('Argumentación (máx. 15)').fill('12'); await page.getByLabel('Redacción (máx. 5)').fill('4'); await page.getByRole('button', { name: /Guardar nota/ }).click();
  await expect(page.getByRole('status')).toHaveText('Nota registrada: 16.');
  await page.getByRole('button', { name: 'Cambiar Ensayo QA de Estudiante actualizado' }).click(); await page.getByLabel('Argumentación (máx. 15)').fill('10');
  await page.getByLabel('Motivo del cambio de nota').fill('Revisión del ensayo solicitada por el estudiante'); await page.getByRole('button', { name: /Guardar nota/ }).click();
  await expect(page.getByRole('status')).toHaveText('Nota registrada: 14.'); await page.screenshot({ path: 'tmp/screens/phase4-gradebook.png', fullPage: true });

  await studentPage.setViewportSize({ width: 1440, height: 1000 }); await studentPage.getByRole('button', { name: 'Evaluaciones', exact: true }).click();
  await expect(studentPage.getByText('Promedio ponderado: 8')).toBeVisible(); await expect(studentPage.getByRole('row', { name: /Ensayo QA/ })).toContainText('14');
  await expect(studentPage.getByRole('button', { name: /Publicar|Calificar/ })).toHaveCount(0); await studentPage.screenshot({ path: 'tmp/screens/phase4-student.png', fullPage: true });

  await page.getByRole('button', { name: /Cerrar sesión/ }).click(); await signIn(page, admin.email);
  await page.getByRole('button', { name: 'Auditoría', exact: true }).click(); await page.getByLabel('Tipo de registro').selectOption('GRADE');
  await expect(page.getByText(/16 → 14/).first()).toBeVisible(); await page.getByRole('button', { name: /Verificar integridad/ }).click();
  await expect(page.getByText(/Cadena íntegra/)).toBeVisible(); await page.screenshot({ path: 'tmp/screens/phase4-audit.png', fullPage: true });
}
