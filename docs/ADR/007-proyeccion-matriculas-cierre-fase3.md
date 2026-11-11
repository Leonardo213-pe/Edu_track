# ADR-007: proyección de matrículas y cierre de la fase 3

Estado: aceptado el 12 de noviembre de 2026, tras la auditoría previa a la fase 4. Amplía ADR-006; no cambia el stack, el backend único ni los hexágonos.

## Contexto

La auditoría encontró que la fase 3 no podía usarse de punta a punta: sin la integración CAR-09 los estudiantes nunca veían cursos (solo con fixtures JSON de prueba). También encontró un limitador de peticiones compartido por todos los clientes detrás de Nginx, historial incompleto, State/Composite parciales, estructura que no podía corregirse en borrador y límites Prisma verificados solo por convención.

El informe (p. 5, RES-01, fig. 16) establece que EduTrack **solo consume la lista de inscritos** del Registro Académico y modela una tabla local `matricula` más `sync_matricula_log`.

## Decisión

1. **Proyección persistida de matrículas** en el módulo `enrollments` (esquema propio `enrollments`): tabla `enrollments` (estudiante, curso, activo) y bitácora `runs` de solo inserción (trigger contra UPDATE/DELETE). La conciliación es idempotente: la lista oficial completa reemplaza la anterior generando altas, reactivaciones y bajas en una transacción con lock por curso.
2. Mientras no exista el adaptador SOAP/REST (CAR-09, etapa de integraciones), la lista oficial la entrega un **ADMIN** (`POST /api/enrollments/courses/:id/roster`). Es una fuente de la misma lista oficial, no una gestión de matrículas del LMS: no hay altas individuales, pagos ni estados académicos. Si algún correo no es un estudiante activo se rechaza todo (`UNKNOWN_STUDENTS`), sin aplicar listas parciales. El futuro adaptador reutilizará `EnrollmentService.synchronize`/el repositorio con otra `source`.
3. Se eliminan los fixtures JSON (`ALLOW_TEST_ENROLLMENTS`, `ENROLLMENT_FIXTURES_FILE`); la configuración rechaza esas variables para no dejar un camino de pruebas en producción.
4. `enrollments` depende solo de `identity` (contrato público `IdentityDirectory.findUsers/findUsersByEmail`). No valida el curso para no crear un ciclo con `courses`; el ID de curso es una referencia opaca.
5. **Proxy confiable:** `TRUST_PROXY` configura `trust proxy` de Express (Compose: `uniquelocal`; nunca `true`). Nginx **sobrescribe** `X-Forwarded-For` con `$remote_addr`, de modo que el límite de peticiones se aplica por cliente real y no puede falsificarse.
6. **Cursos:**
   - Agregado encapsulado: estado privado, vista `DeepReadonly`, `snapshot()` y `advanceRevision()`; la infraestructura ya no muta el dominio.
   - State: cada estado decide además `allowsEditing()` y `visibleToStudents()` (fig. 2, `visibleParaEstudiante`).
   - Composite: unidades/sesiones/materiales responden `count()` y `durationMinutes()`; la sesión tiene duración planificada (0–1440 min) y el curso la suma (fig. 2, `duracionMinutos`).
   - Historial `courses.changes` de solo inserción (trigger contra UPDATE) con acción, responsable, revisión y valores antes/después (incluye sílabo completo). Las decisiones de revisión también rechazan UPDATE y tienen CHECK de decisión.
   - Eliminación de unidades/sesiones/materiales solo en **BORRADOR nunca publicado**. Tras una publicación la estructura solo se amplía o versiona, para no perder contenido aprobado ni avances de estudiantes. Los archivos se eliminan después del commit; un fallo deja un huérfano para conciliación.
   - Listados filtrados en PostgreSQL por rol (docente: propios; estudiante: inscritos y publicados) y nombres por ID, sin recorrer todo el directorio.
   - La autorización de subida se ejecuta antes del parser multipart.
7. **Arquitectura verificable:** la prueba AST también revisa la raíz de composición, contrasta los imports reales con `modules.json` y comprueba que cada adaptador de persistencia solo use delegados Prisma y SQL de su propio esquema.

## Consecuencias

- Los estudiantes acceden a cursos con datos reales sin fixtures; la fase 4 dispone de la precondición de matrícula de CU-03.
- La carga administrativa es manual hasta CAR-09; queda limitada a 1000 estudiantes por curso y operación.
- Las filas de `enrollments.runs` y `courses.changes` no se borran desde la aplicación; las pruebas E2E dejan su bitácora de matrícula de QA.
- Los tres clientes Prisma generados siguen conteniendo todos los modelos (limitación del generador con un esquema central); el aislamiento se garantiza por la prueba de arquitectura y, en producción, deberá reforzarse con roles de BD por esquema.
- El límite de login (5/min por IP) ahora es efectivo. Una institución detrás de NAT comparte IP: antes de producción se recomienda limitador compartido y bloqueo por cuenta (pendiente operativo).
- Deriva preexistente entre `schema.prisma` y la migración de identidad de fase 2 (nombres de índices y `ON UPDATE` de FKs) y la FK intencional `completions_material_fkey`, que solo existe en SQL. No usar `prisma migrate dev` para generar migraciones sin revisar el SQL producido.
