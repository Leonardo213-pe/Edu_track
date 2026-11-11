// DEMO DATA (fictitious people) for a local or demo deployment. It starts an in-process instance of the same backend
// and goes through the real HTTP API, so every business rule, permission, audit entry and outbox event applies.
// Enrollment comes from the SIMULATED Academic Registry ("Sincronizar ahora"). Never run it against production data.
// Usage (requires a built API, the first ADMIN admin@institucion.edu.pe and the API environment variables):
//   SEED_DEMO=true node apps/api/scripts/seed-demo.cjs '<password of the admin and of every new demo account>'
// Inside Compose: docker compose exec -e SEED_DEMO=true -w /app api node apps/api/scripts/seed-demo.cjs '<password>'
require('reflect-metadata');
const path = require('node:path');
const { createApplication } = require(path.join(__dirname, '..', 'dist', 'bootstrap.js'));
const { loadConfig } = require(path.join(__dirname, '..', 'dist', 'config.js'));
if (process.env.SEED_DEMO !== 'true') { console.error('Set SEED_DEMO=true to load fictitious demo data.'); process.exit(2); }

const PASSWORD = process.argv[2];
const ADMIN = { email: 'admin@institucion.edu.pe' };
const PERIOD = '2026-II';
const day = 24 * 3600_000;
let seed = 20261111; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = list => list[Math.floor(rand() * list.length)];
const round = (value, step = 0.5) => Math.round(value / step) * step;

const teachers = [
  ['docente@institucion.edu.pe', 'Docente Demo'], ['docente2@institucion.edu.pe', 'Docente Ajeno'],
  ['maria.garcia@institucion.edu.pe', 'María García'], ['jorge.ramirez@institucion.edu.pe', 'Jorge Ramírez'], ['lucia.torres@institucion.edu.pe', 'Lucía Torres'],
];
const designers = [['disenador@institucion.edu.pe', 'Diseñador Demo'], ['patricia.vega@institucion.edu.pe', 'Patricia Vega']];
const studentNames = ['Ana Quispe', 'Bruno Huamán', 'Carla Rojas', 'Diego Salas', 'Elena Paredes', 'Fernando Castillo', 'Gabriela Flores', 'Hugo Mendoza',
  'Isabel Chávez', 'Javier Ríos', 'Karina Vargas', 'Luis Gutiérrez', 'Mariana Soto', 'Nicolás Herrera', 'Olga Ramos', 'Pedro Silva', 'Rosa Medina',
  'Sergio Cárdenas', 'Tatiana Núñez', 'Ulises Espinoza', 'Valeria Campos', 'Walter Ortiz', 'Ximena Aguilar', 'Yolanda Peña'];
const slug = name => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ /g, '.');
const students = studentNames.map((name, index) => ({ email: `${slug(name)}@alumnos.edutrack.test`, name, code: String(20260001 + index), skill: 0.35 + rand() * 0.6 }));

const courses = [
  { code: 'SW-401', name: 'Arquitectura de Software', teacher: 'docente@institucion.edu.pe', state: 'PUBLICADO', students: [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    description: 'Estilos arquitectónicos, arquitectura hexagonal, monolitos modulares, atributos de calidad y decisiones documentadas en ADR.',
    units: [['Fundamentos de arquitectura', ['Atributos de calidad', 'Estilos y patrones']], ['Arquitectura hexagonal', ['Puertos y adaptadores', 'Monolito modular']]] },
  { code: 'BD-201', name: 'Bases de Datos', teacher: 'maria.garcia@institucion.edu.pe', state: 'PUBLICADO', students: [3, 4, 5, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    description: 'Modelo relacional, SQL, normalización, transacciones e índices con PostgreSQL.',
    units: [['Modelo relacional', ['Entidades y relaciones', 'Normalización']], ['SQL y transacciones', ['Consultas avanzadas', 'Aislamiento y bloqueos']]] },
  { code: 'MA-201', name: 'Cálculo II', teacher: 'jorge.ramirez@institucion.edu.pe', state: 'PUBLICADO', students: [0, 3, 6, 9, 12, 13, 15, 17, 19, 20, 21, 22, 23, 1, 2],
    description: 'Integrales definidas e impropias, técnicas de integración, series y aplicaciones.',
    units: [['Integración', ['Técnicas de integración', 'Integrales impropias']], ['Series', ['Series numéricas', 'Series de potencias']]] },
  { code: 'RD-301', name: 'Redes de Computadoras', teacher: 'lucia.torres@institucion.edu.pe', state: 'PUBLICADO', students: [7, 8, 10, 11, 14, 16, 18, 19, 22, 23],
    description: 'Modelo TCP/IP, enrutamiento, transporte, seguridad básica y diagnóstico de redes.',
    units: [['Capas inferiores', ['Ethernet y conmutación', 'Direccionamiento IP']], ['Transporte y aplicación', ['TCP y UDP', 'HTTP y TLS']]] },
  { code: 'EST-210', name: 'Estadística Aplicada', teacher: 'docente2@institucion.edu.pe', state: 'EN_REVISION', students: [],
    description: 'Estadística descriptiva, probabilidad, inferencia y regresión lineal aplicada.',
    units: [['Estadística descriptiva', ['Medidas de tendencia', 'Visualización']]] },
  { code: 'CO-110', name: 'Comunicación Académica', teacher: 'maria.garcia@institucion.edu.pe', state: 'BORRADOR', students: [],
    description: 'Lectura crítica, redacción de textos académicos y citación.', units: [['Lectura crítica', ['Tipos de texto']]] },
];
const questionBank = {
  'SW-401': [['La arquitectura hexagonal aísla el dominio de la infraestructura mediante puertos.', true], ['Un monolito modular implica desplegar cada módulo por separado.', false],
    ['Un ADR documenta el contexto, la decisión y sus consecuencias.', true], ['El patrón outbox garantiza que un evento y su cambio se guarden en la misma transacción.', true],
    ['La disponibilidad no es un atributo de calidad.', false], ['Un adaptador implementa un puerto definido por la aplicación.', true],
    ['El dominio debe depender del ORM para ser eficiente.', false], ['Los contratos públicos permiten comunicar módulos sin compartir tablas.', true]],
  'BD-201': [['La tercera forma normal elimina dependencias transitivas.', true], ['Una clave foránea puede referenciar cualquier columna sin índice único.', false],
    ['READ COMMITTED evita las lecturas sucias.', true], ['Un índice siempre acelera las escrituras.', false], ['SELECT ... FOR UPDATE bloquea las filas leídas.', true],
    ['Una transacción cumple ACID.', true], ['DELETE sin WHERE borra solo la primera fila.', false], ['Una vista materializada almacena el resultado de la consulta.', true]],
  'MA-201': [['La integral de 1/x es ln|x| + C.', true], ['Toda serie cuyo término tiende a 0 converge.', false], ['La serie geométrica converge si |r| < 1.', true],
    ['La integración por partes se basa en la regla del producto.', true], ['La integral de 1/x² entre 1 e infinito diverge.', false], ['e^x es su propia derivada.', true],
    ['La serie armónica converge.', false], ['El radio de convergencia puede ser infinito.', true]],
  'RD-301': [['TCP ofrece entrega ordenada y confiable.', true], ['UDP establece una conexión antes de enviar datos.', false], ['Una máscara /24 tiene 254 hosts utilizables.', true],
    ['HTTP/1.1 usa por defecto el puerto 443.', false], ['DNS traduce nombres a direcciones IP.', true], ['TLS 1.0 se considera seguro hoy.', false],
    ['Un switch opera en la capa de enlace.', true], ['ARP resuelve direcciones IP a MAC.', true]],
};
const sentences = ['El trabajo analiza el problema planteado y propone una solución basada en los conceptos del curso.',
  'Se identificaron los requisitos principales y se justificaron las decisiones tomadas con ejemplos concretos.',
  'La implementación se validó con casos de prueba representativos y se documentaron sus limitaciones.',
  'Se compararon dos alternativas y se eligió la que mejor equilibra mantenibilidad y rendimiento.',
  'Los resultados obtenidos confirman la hipótesis inicial aunque requieren más datos para generalizarse.',
  'Finalmente se proponen mejoras y líneas de trabajo futuro para el siguiente entregable.',
  'El análisis considera el contexto institucional y las restricciones de tiempo y presupuesto del proyecto.',
  'Se elaboró un diagrama que resume los componentes y sus responsabilidades principales.'];
const essay = (student, topic) => `Informe de avance de ${student.name} sobre ${topic}. ` + Array.from({ length: 5 }, () => pick(sentences)).join(' ') +
  ` Como conclusión personal, ${student.name.split(' ')[0]} destaca que ${topic.toLowerCase()} exige criterio y práctica constante.`;

(async () => {
  if (!PASSWORD || PASSWORD.length < 12) throw new Error('Password argument required (>= 12 chars)');
  const config = loadConfig(process.env);
  const app = await createApplication({ ...config, port: 0, trustProxy: 'loopback', examJobIntervalMs: 500 });
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
  let ip = 0;
  async function call(method, route, token, body, expected) {
    const n = ++ip; const multipart = body instanceof FormData;
    const response = await fetch(base + route, { method, headers: { 'X-Forwarded-For': `10.77.${(n >> 8) & 255}.${n & 255}`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) });
    const text = await response.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok && !(expected ?? []).includes(response.status)) throw new Error(`${method} ${route} -> ${response.status} ${typeof data === 'string' ? data : JSON.stringify(data)}`.slice(0, 400));
    return data;
  }
  const login = async email => (await call('POST', '/identity/login', null, { email, password: PASSWORD })).accessToken;
  const summary = { users: 0, courses: 0, enrolled: 0, materialsCompleted: 0, quizzesFinalized: 0, submissions: 0, rubricGrades: 0, forumMessages: 0 };
  try {
    const admin = await login(ADMIN.email);
    const existingCourses = await call('GET', '/courses', admin);
    if (existingCourses.some(course => course.code === 'SW-401')) { console.log('Demo data already present (SW-401 exists); nothing to do.'); return; }
    // 1. Accounts (skip existing ones).
    const known = new Map();
    for (let offset = 0; ; offset += 100) {
      const page = await call('GET', `/identity/users?limit=100&offset=${offset}`, admin);
      for (const user of page) known.set(user.email, user.id);
      if (page.length < 100) break;
    }
    async function account(email, displayName, role) {
      if (!known.has(email)) { known.set(email, (await call('POST', '/identity/users', admin, { email, displayName, password: PASSWORD, role })).id); summary.users++; }
      return known.get(email);
    }
    for (const [email, name] of teachers) await account(email, name, 'TEACHER');
    for (const [email, name] of designers) await account(email, name, 'INSTRUCTIONAL_DESIGNER');
    for (const student of students) student.id = await account(student.email, student.name, 'STUDENT');
    const tokens = new Map();
    const tokenOf = async email => { if (!tokens.has(email)) tokens.set(email, await login(email)); return tokens.get(email); };

    // 2. Courses through their real lifecycle: draft -> content -> review -> published.
    for (const spec of courses) {
      const teacher = await tokenOf(spec.teacher);
      let course = await call('POST', '/courses', teacher, { code: spec.code, name: spec.name, description: spec.description, period: PERIOD, teacherId: known.get(spec.teacher) });
      course = await call('PATCH', `/courses/${course.id}`, teacher, { code: course.code, name: course.name, description: course.description, period: course.period, teacherId: course.teacherId,
        syllabus: `Sumilla: ${spec.description}\n\nResultados de aprendizaje: aplicar los conceptos del curso en casos reales y comunicar decisiones con fundamento.\n\nEvaluación: cuestionarios (30 %), informe de avance (30 %), práctica calificada (20 %) y participación (20 %).`, revision: course.revision });
      for (const [unitIndex, [unitTitle, sessions]] of spec.units.entries()) {
        course = await call('POST', `/courses/${course.id}/units`, teacher, { title: unitTitle, revision: course.revision });
        const unit = course.units[unitIndex];
        for (const [sessionIndex, sessionTitle] of sessions.entries()) {
          course = await call('POST', `/courses/${course.id}/units/${unit.id}/sessions`, teacher, { title: sessionTitle, description: `Sesión ${sessionIndex + 1} de la unidad «${unitTitle}».`, durationMinutes: 90, revision: course.revision });
          const session = course.units[unitIndex].sessions[sessionIndex];
          course = await call('POST', `/courses/${course.id}/sessions/${session.id}/materials`, teacher, { title: `Lectura: ${sessionTitle}`, kind: 'LINK',
            url: `https://es.wikipedia.org/wiki/${encodeURIComponent(sessionTitle.replace(/ /g, '_'))}`, revision: course.revision });
        }
      }
      if (spec.state !== 'BORRADOR') course = await call('POST', `/courses/${course.id}/transitions`, teacher, { decision: 'SUBMITTED', observations: '', revision: course.revision });
      if (spec.state === 'PUBLICADO') course = await call('POST', `/courses/${course.id}/transitions`, await tokenOf(pick(designers)[0]), { decision: 'APPROVED', observations: 'Contenido y sílabo aprobados.', revision: course.revision });
      spec.course = course; summary.courses++;
    }

    // 3. Official rosters in the SIMULATED Academic Registry, then "Sincronizar ahora" (source REGISTRY_SYNC).
    for (const spec of courses.filter(item => item.students.length)) {
      const response = await fetch(`${process.env.REGISTRY_URL}/admin/sections/${spec.code}/${PERIOD}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Registry-Key': process.env.REGISTRY_API_KEY },
        body: JSON.stringify({ students: spec.students.map(index => ({ email: students[index].email, code: students[index].code, name: `${students[index].name} (ficticio)` })) }) });
      if (!response.ok) throw new Error(`registry section ${spec.code}: ${response.status}`);
    }
    const run = await call('POST', '/enrollments/registry/sync', admin);
    if (run.status !== 'SUCCEEDED') throw new Error(`registry sync ${run.status}: ${run.error}`);
    summary.enrolled = run.added;

    // 4. Academic activity in the published courses.
    for (const spec of courses.filter(item => item.state === 'PUBLICADO')) {
      const teacher = await tokenOf(spec.teacher); const course = spec.course; const enrolled = spec.students.map(index => students[index]);
      const materials = course.units.flatMap(unit => unit.sessions.flatMap(session => session.materials));
      // Bank + random quiz.
      const banks = await call('POST', `/assessments/courses/${course.id}/banks`, teacher, { name: `Banco ${spec.code}` });
      const bank = (Array.isArray(banks) ? banks : [banks]).find(item => item.name === `Banco ${spec.code}`) ?? banks[0];
      const answerKey = new Map();
      for (const [statement, truth] of questionBank[spec.code]) {
        await call('POST', `/assessments/banks/${bank.id}/questions`, teacher, { type: 'TRUE_FALSE', statement, points: 1, options: [{ text: 'Verdadero', correct: truth }, { text: 'Falso', correct: !truth }] });
        answerKey.set(statement, truth ? 'Verdadero' : 'Falso');
      }
      const quiz = await call('POST', `/assessments/courses/${course.id}`, teacher, { title: 'Cuestionario Unidad 1', instructions: 'Cinco preguntas al azar del banco. Tienes 30 minutos.', type: 'QUIZ', weight: 30,
        dueAt: new Date(Date.now() + 14 * day).toISOString(), durationMinutes: 30, questionCount: 5, bankId: bank.id });
      await call('POST', `/assessments/${quiz.id}/publish`, teacher, { revision: 0 });
      const criteria = [{ description: 'Contenido y argumentación', maxPoints: 12 }, { description: 'Redacción y orden', maxPoints: 4 }, { description: 'Referencias', maxPoints: 4 }];
      const report = await call('POST', `/assessments/courses/${course.id}`, teacher, { title: 'Informe de avance', instructions: 'Entrega un informe (PDF, DOCX o TXT) con el avance del proyecto del curso.', type: 'RUBRIC', weight: 30,
        dueAt: new Date(Date.now() + 10 * day).toISOString(), criteria });
      const reportPublished = await call('POST', `/assessments/${report.id}/publish`, teacher, { revision: 0 });
      const practice = await call('POST', `/assessments/courses/${course.id}`, teacher, { title: 'Práctica calificada 1', instructions: 'Resolución de ejercicios en clase.', type: 'RUBRIC', weight: 20,
        dueAt: new Date(Date.now() + 3 * day).toISOString(), criteria: [{ description: 'Planteamiento', maxPoints: 10 }, { description: 'Resultado', maxPoints: 10 }] });
      const practicePublished = await call('POST', `/assessments/${practice.id}/publish`, teacher, { revision: 0 });
      // Forum with participation.
      const forum = await call('POST', `/collaboration/courses/${course.id}/forums`, teacher, { title: 'Consultas generales', description: 'Dudas sobre clases, evaluaciones y materiales.' });
      const author = enrolled[0]; const thread = await call('POST', `/collaboration/forums/${forum.id}/threads`, await tokenOf(author.email),
        { title: '¿Cómo se evalúa el informe de avance?', body: 'Profesor, ¿la rúbrica considera las referencias en formato APA?' });
      await call('POST', `/collaboration/threads/${thread.id}/messages`, teacher, { body: 'Sí: el criterio «Referencias» vale 4 puntos y se acepta APA 7.ª edición.' });
      await call('POST', `/collaboration/threads/${thread.id}/messages`, await tokenOf(enrolled[1].email), { body: 'Gracias, también tenía esa duda.' });
      summary.forumMessages += 3;
      // Students: progress, connection time, quiz attempt, report submission.
      for (const [index, student] of enrolled.entries()) {
        const token = await tokenOf(student.email);
        for (const material of materials) if (rand() < student.skill) { await call('POST', `/courses/${course.id}/materials/${material.id}/complete`, token); summary.materialsCompleted++; }
        if (rand() < 0.8) await call('POST', `/analytics/courses/${course.id}/heartbeat`, token, {});
        if (rand() < 0.7) {
          const attempt = await call('POST', `/exams/assessments/${quiz.id}/attempt`, token, {});
          for (const question of attempt.questions) {
            const right = answerKey.get(question.statement); const choice = rand() < student.skill ? right : (right === 'Verdadero' ? 'Falso' : 'Verdadero');
            await call('PUT', `/exams/attempts/${attempt.id}/answers/${question.questionId}`, token, { optionIds: [question.options.find(option => option.text === choice).id], version: 1 });
          }
          await call('POST', `/exams/attempts/${attempt.id}/finalize`, token, {}); summary.quizzesFinalized++;
        }
        if (index < 6) {
          // In SW-401 the second student copies most of the first one's report, so the SIMULATED provider flags it.
          const text = spec.code === 'SW-401' && index === 1 ? `${enrolled[0].submittedText} Agrego un párrafo final propio.` : essay(student, spec.name);
          student.submittedText = text; if (index === 0) enrolled[0].submittedText = text;
          const form = new FormData(); form.append('file', new Blob([text], { type: 'text/plain' }), `informe-${slug(student.name)}.txt`);
          await call('POST', `/submissions/assessments/${report.id}`, token, form); summary.submissions++;
        }
      }
      // Teacher grades: the practice for everyone, the report for the first three submissions.
      for (const [index, student] of enrolled.entries()) {
        const level = Math.min(1, Math.max(0.15, student.skill + (rand() - 0.5) * 0.2));
        await call('POST', `/grading/assessments/${practice.id}/students/${student.id}`, teacher,
          { awards: practicePublished.criteria.map(criterion => ({ criterionId: criterion.id, points: round(criterion.maxPointsCents / 100 * level) })) }); summary.rubricGrades++;
        if (index < 3) { await call('POST', `/grading/assessments/${report.id}/students/${student.id}`, teacher,
          { awards: reportPublished.criteria.map(criterion => ({ criterionId: criterion.id, points: round(criterion.maxPointsCents / 100 * level) })) }); summary.rubricGrades++; }
      }
    }
    console.log(JSON.stringify(summary));
  } finally {
    await new Promise(resolve => setTimeout(resolve, 4000)); // let the in-process jobs drain (automatic grading, plagiarism)
    await app.close();
  }
})().catch(error => { console.error('SEED FAILED:', error.message); process.exit(1); });
