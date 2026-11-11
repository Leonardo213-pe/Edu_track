# Gestión de cursos y contenidos — fase 3

Funcionalidades:
- Crear, listar y editar cursos con código, nombre, descripción, período y docente.
- Sílabo.
- Unidades y sesiones ordenadas, con duración planificada por sesión y duración total del curso.
- Materiales y versiones.
- Eliminación de elementos en borradores nunca publicados.
- Revisión con observaciones y archivado.
- Historial de cambios.
- Inscritos del curso, acceso estudiantil, completitud y seguimiento.

La interfaz está en Cursos, Mis cursos o Revisión de cursos, según el rol. Decisiones de cierre de la fase en [ADR-007](ADR/007-proyeccion-matriculas-cierre-fase3.md).

## Uso

```sh
npm ci
npm run generate
npm run build
docker compose up --build -d --wait
```

Las migraciones se aplican al arrancar la API sin borrar datos existentes. Los usuarios de los cuatro roles se crean desde la fase 2; no hay cuentas predeterminadas. El flujo completo es:

1. El docente crea un borrador, completa sílabo, unidades, sesiones y materiales, y lo envía a revisión.
2. El diseñador instruccional abre el detalle y registra aprobación o rechazo con observaciones. Solo la aprobación publica.
3. El ADMIN sincroniza en **Inscritos** la lista oficial de estudiantes del curso.
4. El estudiante ve el curso publicado en **Mis cursos**, consume el material y marca su avance.

Para editar un curso publicado hay que volver explícitamente a Borrador y repetir la revisión. Mientras tanto, los estudiantes pierden el acceso.

Mientras el curso **nunca haya sido publicado**, el docente o el ADMIN pueden eliminar unidades, sesiones o materiales creados por error; también se eliminan los archivos de sus versiones. Después de una publicación la estructura se conserva y solo puede ampliarse o versionarse.

Los archivos se guardan en el volumen `edutrack_course_files`, con raíz `/app/storage/courses`. El puerto permite reemplazar el adaptador por S3 en el futuro, pero S3 no está integrado. No borrar volúmenes para actualizar. En desarrollo sin Docker, `COURSE_STORAGE_ROOT` cambia la raíz (por defecto `storage/courses`, relativa al directorio de trabajo del proceso).

## Inscritos (proyección de matrícula)

EduTrack no gestiona matrículas: consume la lista oficial del Registro Académico (RES-01). Esa lista vive en el módulo `enrollments` como **proyección persistida en PostgreSQL**.

- Hasta que exista el adaptador SOAP/REST de CAR-09, un ADMIN pega la lista oficial de correos en la pestaña **Inscritos** del curso, o usa `POST /api/enrollments/courses/:courseId/roster`.
- Cada sincronización reemplaza la lista completa: registra altas, reactivaciones y bajas en una transacción, y guarda la ejecución en una bitácora de solo inserción.
- Repetir la misma lista no produce cambios.
- Si algún correo no corresponde a un estudiante activo, se rechaza la lista completa y se informan esos correos.
- Sin inscripción activa, el estudiante no ve el curso ni descarga sus archivos.

Los fixtures JSON de versiones anteriores (`ALLOW_TEST_ENROLLMENTS`, `ENROLLMENT_FIXTURES_FILE`) se eliminaron. La API se niega a arrancar si siguen activos.

## Contrato HTTP

OpenAPI 3.1: [openapi.json](openapi.json), servidor `/api`, Bearer JWT de fase 2.

Cada mutación académica requiere el valor `revision` del GET más reciente, salvo el alta inicial y la completitud. En las eliminaciones se envía como query `?revision=`. Un 409 obliga a recargar y revisar; no se sobrescribe automáticamente.

| Método / ruta relativa a `/api/courses` | Entrada / función |
| --- | --- |
| GET `/` | Resúmenes filtrados en la base de datos: docente (propios), estudiante (inscritos y publicados), ADMIN/diseñador (todos) |
| POST `/` | code, name, description, period, teacherId; solo el docente propio o ADMIN |
| GET `/teachers` | Directorio mínimo de docentes activos, solo ADMIN |
| GET `/:id` | Estructura completa, `durationMinutes`, contenido autorizado, `removable` (personal) y progreso (estudiante) |
| GET `/:id/history` | Historial de solo inserción (acción, responsable, antes/después); ADMIN, diseñador o docente responsable |
| PATCH `/:id` | Metadatos completos, syllabus, revision; solo en Borrador |
| POST `/:id/units` · PATCH `/:id/units/:unitId` | title, revision |
| DELETE `/:id/units/:unitId?revision=` | Solo borrador nunca publicado |
| POST `/:id/units/:unitId/sessions` · PATCH `/:id/sessions/:sessionId` | title, description, durationMinutes (0–1440, opcional), revision |
| DELETE `/:id/sessions/:sessionId?revision=` | Solo borrador nunca publicado |
| POST `/:id/order` | type=units/sessions/materials, parentId, ids (permutación exacta), revision |
| POST `/:id/sessions/:sessionId/materials` | title, kind, revision; materialId opcional para una nueva versión. FILE: multipart `file` (se autoriza antes de leer el cuerpo); LINK/VIDEO: url HTTP(S) |
| DELETE `/:id/materials/:materialId?revision=` | Solo borrador nunca publicado; elimina los archivos de sus versiones |
| GET `/:id/materials/:materialId/versions/:versionId/file` | Bytes autorizados, sin rutas públicas; el estudiante solo accede a la versión vigente |
| POST `/:id/transitions` | decision=SUBMITTED/APPROVED/REJECTED/REOPENED/ARCHIVED, observations, revision |
| POST `/:id/materials/:materialId/complete` | Versión vigente, idempotente, solo estudiante inscrito |
| GET `/:id/progress` | Avance por estudiante con actividad (nombre y porcentaje); solo docente responsable o ADMIN |

| Método / ruta relativa a `/api/enrollments` | Función |
| --- | --- |
| GET `/courses/:courseId` | Inscritos activos y últimas 20 sincronizaciones; solo ADMIN |
| POST `/courses/:courseId/roster` | `{ emails: string[] }` (máximo 1000), lista oficial completa; solo ADMIN; 400 `UNKNOWN_STUDENTS` con `unknown` |

Códigos de error:

| HTTP | Código |
| --- | --- |
| 400 | INVALID_INPUT, INCOMPLETE_COURSE, FILE_REJECTED, UNKNOWN_STUDENTS |
| 401 | Sesión inválida |
| 403 | FORBIDDEN |
| 404 | NOT_FOUND |
| 409 | CONFLICT, INVALID_STATE |
| 413 | Archivo de más de 25 MiB |
| 429 | Límite de peticiones (por cliente real detrás de Nginx) |

El body, los UUID y los campos extra se validan antes de delegar al caso de uso. Nunca se acepta el rol ni el actor desde el body.

## Pruebas y límites

- `npm run check`.
- Integración con la base explícita `edutrack_test` (ver README): `npm run test:integration`. Usa la proyección real de matrículas mediante HTTP y nunca se conecta a una base institucional.

Recorrido en navegador real con Compose levantado:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.tools\playwright"
$env:COURSES_E2E = 'true'
npm.cmd run test:e2e
```

El recorrido cubre:
- Identidad.
- Creación del curso, sílabo, unidad eliminada por error, sesión con duración, subida real e historial.
- Aprobación por el diseñador.
- Estudiante sin acceso antes de la inscripción; sincronización de la lista oficial por el ADMIN.
- Visor del material y completitud en móvil.

Espera 61 s antes del sexto inicio de sesión, porque el límite de login (5/min por IP) ahora es efectivo y todos los navegadores de la prueba comparten una IP. Al terminar elimina sus cuentas, cursos, archivos e inscripciones; la bitácora de solo inserción se conserva por diseño.

Pendientes fuera de esta fase:
- Adaptador real del Registro Académico (CAR-09).
- S3 y antivirus.
- Retención y conciliación de archivos huérfanos.
- Rangos de video.
- Publicación anterior en paralelo a una revisión nueva.
- Editor enriquecido de sílabo.

Evaluaciones no se implementan en esta fase. TLS de producción y un limitador compartido o por cuenta siguen como pendientes operativos.
