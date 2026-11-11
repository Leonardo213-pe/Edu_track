# Gestión de cursos y contenidos — etapa 3

Funcionalidades: crear/listar/editar cursos con código, nombre, descripción, período y docente; sílabo; unidades/sesiones ordenadas; materiales y versiones; revisión con observaciones; archivado; acceso estudiantil y completitud; historial y seguimiento básico. UI desde Cursos/Mis cursos/Revisión de cursos según el rol.

## Uso

```sh
npm ci
npm run generate
npm run build
docker compose up --build -d --wait
```

Las migraciones se aplican al arrancar la API sin borrar usuarios existentes. Crear los usuarios de los cuatro roles mediante fase 2; no hay cuentas predeterminadas. Un docente crea un borrador, completa sílabo/unidades/sesiones/materiales y envía a revisión. El diseñador abre el detalle, revisa, registra aprobación o rechazo con observaciones. Solo aprobación publica. Para editar publicado, volver explícitamente a borrador y repetir revisión; estudiantes pierden acceso mientras tanto. Las pantallas consumen endpoints reales.

Archivos locales en volumen `edutrack_course_files` y raíz `/app/storage/courses`. El puerto admite reemplazar el adaptador por S3 en el futuro, sin afirmar que S3 esté integrado. No borrar volúmenes para actualizar. Desarrollo sin Docker: `COURSE_STORAGE_ROOT` permite cambiar raíz, por defecto `storage/courses` respecto al cwd del proceso.

## Matrículas de prueba explícitas

La sincronización institucional todavía no existe: por defecto los estudiantes no ven cursos. No hay alta manual de matrículas en Cursos. Para un entorno **exclusivamente de desarrollo**, crear `tmp/enrollments/demo.json` con IDs reales ya existentes:

```json
[
  { "studentId": "UUID_REAL_DEL_ESTUDIANTE", "courseId": "UUID_REAL_DEL_CURSO", "active": true }
]
```

Los valores son marcadores de documentación, no datos sembrados. Configurar PowerShell:

```powershell
$env:ALLOW_TEST_ENROLLMENTS = 'true'
$env:ENROLLMENT_FIXTURES_FILE = '/app/fixtures/demo.json'
docker compose up -d --wait
```

El archivo se monta solo lectura en `/app/fixtures`. Para API local usar ruta absoluta del host. Para deshabilitar, quitar ambas variables y recrear API; nunca presentar estos fixtures como una integración real. El archivo no debe contener credenciales y está ignorado por Git. No habilitar en producción. Al futuro adaptador institucional le bastará implementar el contrato público.

## Contrato HTTP

OpenAPI 3.1: [openapi.json](openapi.json), servidor `/api`, Bearer JWT de fase 2. Cada mutación académica (excepto alta inicial/completitud) requiere `revision` del GET más reciente. Conflicto 409 obliga a recargar y revisar, no a sobreescribir automáticamente.

| Método / ruta relativa a `/api/courses` | Entrada / función |
| --- | --- |
| GET `/` | Resúmenes filtrados por rol, propietario, estado y matrícula |
| POST `/` | code, name, description, period, teacherId; solo docente propio/ADMIN |
| GET `/teachers` | Directorio mínimo de docentes activos, solo ADMIN |
| GET `/:id` | Estructura completa, contenido autorizado y progreso estudiantil |
| PATCH `/:id` | Metadatos completos, syllabus, revision; solo Borrador |
| POST `/:id/units` | title, revision |
| PATCH `/:id/units/:unitId` | title, revision |
| POST `/:id/units/:unitId/sessions` | title, description, revision |
| PATCH `/:id/sessions/:sessionId` | title, description, revision |
| POST `/:id/order` | type=units/sessions/materials, parentId, ids (permutación exacta), revision |
| POST `/:id/sessions/:sessionId/materials` | title, kind, revision; materialId opcional para nueva versión. FILE: multipart `file`; LINK/VIDEO: url HTTP(S) |
| GET `/:id/materials/:materialId/versions/:versionId/file` | Bytes autorizados, no rutas públicas; estudiantes solo vigente |
| POST `/:id/transitions` | decision=SUBMITTED/APPROVED/REJECTED/REOPENED/ARCHIVED, observations, revision |
| POST `/:id/materials/:materialId/complete` | Versión vigente, idempotente, solo estudiante autorizado |
| GET `/:id/progress` | Actividad por ID/avance, solo responsable/ADMIN; no es padrón de inscritos |

Errores: 400 INVALID_INPUT/INCOMPLETE_COURSE/FILE_REJECTED; 401 sesión; 403 FORBIDDEN; 404 NOT_FOUND; 409 CONFLICT/INVALID_STATE; 413 archivo >25 MiB; 429 límite existente. Body/UUID/campos extra validados antes de delegar. Sin rol ni actor aceptados desde body.

## Pruebas y límites

`npm run check`; integración con base explícita `edutrack_test` (README) y fixtures temporales: `npm run test:integration`. No se conectan a BD institucional. Se incluyen regresiones completas de identidad y almacenamiento real con comparación de bytes/hash y revisión de conflictos.

Recorrido navegador con matrículas de prueba: preparar `tmp/enrollments/e2e.json` como `[]`, habilitar las dos variables anteriores con ese archivo y levantar Compose. Después:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.tools\playwright"
$env:COURSES_E2E = 'true'
npm.cmd run test:e2e
```

El recorrido reutiliza la prueba de identidad y añade docente/diseñador/estudiante, curso/sílabo/estructura/subida real, aprobación, visor y completitud en móvil. Elimina sus cuentas/cursos/archivos al terminar; no modifica cuentas existentes. Deshabilitar fixtures tras el ensayo. Ver resultados observados en VERIFICACION.md.

Pendientes fuera de esta fase: sincronización real de matrícula, S3, antivirus, retención/conciliación de archivos huérfanos, rangos de video, publicación anterior paralela a una revisión nueva, edición visual enriquecida de sílabo y eliminación física de contenido. Evaluaciones no se implementan. Se conserva TLS de producción y límite compartido como pendientes operativos del proyecto.
