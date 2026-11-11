# EduTrack LMS

Proyecto universitario cerrado: identidad, cursos y contenidos, banco de preguntas y calificación auditada, exámenes contra reloj, foros/notificaciones/riesgo, **matrículas nocturnas, tareas con control de plagio y monitoreo/operación** ([ADR-011](docs/ADR/011-cierre-matriculas-tareas-operacion.md)). Arquitectura hexagonal y monolito modular: un único backend NestJS (2 réplicas en Compose), React y PostgreSQL; Prisma solo en adaptadores.

Las integraciones externas son **SIMULADAS** por autorización del usuario y están marcadas así en código, interfaz y documentación: el Registro Académico (`infra/registry`) y el proveedor de plagio (`SIMULADO-NGRAM-v1`). La «nube» es Docker Compose local. Qué es real y qué es simulado: [docs/ENTREGA.md](docs/ENTREGA.md).

## Requisitos y decisiones

Fuente: [informe original](docs/Informe_Trabajo_Final_EduTrack_LMS.pdf). [Análisis y diferencias](docs/ANALISIS_REQUISITOS.md), [arquitectura](docs/ARCHITECTURE.md), [módulos](docs/MODULOS.md), [ADR](docs/ADR/), [plan](docs/PLAN_DESARROLLO.md), [trazabilidad](docs/TRAZABILIDAD.md), [C4](docs/diagrams/C4.md), [4+1](docs/diagrams/MODELO_4_MAS_1.md) y [verificación real](docs/VERIFICACION.md).

NestJS 11, React 19, TypeScript 5.9, Prisma 7, Vite 7, PostgreSQL 17 y Node.js 24 LTS. `package-lock.json` fija las versiones exactas. Se prioriza una combinación comprobada; no se cambia de major automáticamente. La elección TypeScript y el backend único sustituyen Java/Spring y API/Worker del PDF por instrucción del usuario (ADR-001/002).

## Arranque con Docker

Requisitos: Node.js 24/npm 11+ para herramientas locales y Docker Engine con Compose y contenedores Linux.

En este equipo Node no estaba instalado globalmente; se descargó y verificó una copia portátil ignorada por Git. Para usarla en PowerShell durante esta sesión:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.2-win-x64;$env:Path"
# Usar npm.cmd si la política de PowerShell bloquea npm.ps1.
```

```sh
npm ci
npm run setup:env
docker compose up --build -d --wait
```

`setup:env` crea secretos aleatorios en `.env` (incluidos `REGISTRY_API_KEY` y `APP_DB_PASSWORD`) y se niega a sobrescribirlo; en un `.env` anterior hay que añadir esas dos claves. No hay cuentas o contraseñas predeterminadas. Acceso web: **https://localhost:8443** (certificado local autofirmado: el navegador pedirá aceptarlo; http://localhost:8080 redirige). La API solo es accesible a través de Nginx (`/api`).

Topología local: el servicio `migrate` aplica las migraciones con el propietario y aprovisiona el rol `edutrack_app` (sin propiedad ni UPDATE/DELETE en auditoría); `api` y `api2` son dos réplicas del mismo backend detrás de Nginx (TLS 1.2/1.3); `registry` es el Registro Académico **SIMULADO** (http://localhost:4010/health). Volúmenes: `postgres_data`, `course_files` (cursos y entregas), `audit_anchors` (anclaje del hash de auditoría, separado de la BD) y `tls_certs`. `docker compose down` detiene el entorno sin borrar volúmenes.

En el `.env` de este equipo se configuró PostgreSQL en **5433** porque 5432 ya estaba ocupado. El generador usa 5432 como valor inicial en otros equipos; cambiar juntos `POSTGRES_PORT` y el puerto de `DATABASE_URL` si hay conflicto.

Crear el primer administrador desde un shell local con acceso a la base de datos:

```sh
npm run generate
npm run build
```

PowerShell (contraseña oculta en pantalla y fuera de los argumentos/historial):

```powershell
$securePassword = Read-Host 'Contraseña inicial (12-128 caracteres)' -AsSecureString
$credential = New-Object System.Management.Automation.PSCredential('bootstrap', $securePassword)
$credential.GetNetworkCredential().Password | npm.cmd run user:create -- admin@institucion.edu.pe "Administrador" ADMIN
Remove-Variable securePassword,credential
```

Bash:

```bash
read -r -s -p 'Contraseña inicial: ' initial_password; echo
printf '%s' "$initial_password" | npm run user:create -- admin@institucion.edu.pe "Administrador" ADMIN
unset initial_password
```

La CLI solo crea el **primer ADMIN si no hay administrador activo**; no permite saltarse la administración existente. Las altas posteriores se hacen desde el panel como administrador. Roles: `STUDENT`, `TEACHER`, `INSTRUCTIONAL_DESIGNER`, `ADMIN`. Cada usuario puede cambiar su contraseña o recuperar el acceso por correo. Conservar la contraseña inicial por un canal institucional seguro.

## Desarrollo local

```sh
npm ci
npm run setup:env  # una sola vez
docker compose up -d db mailpit --wait
npm run generate
npm run db:migrate
npm run build
npm run dev:api
# otra terminal
npm run dev:web
```

Web en http://localhost:5173 con proxy a la API 3000. `dev:api` observa JavaScript compilado; tras editar TypeScript ejecutar `npm run build -w @edutrack/api` o `npx tsc -p apps/api/tsconfig.build.json --watch` en otra terminal. No ejecutar la API local y la API Compose en el mismo puerto simultáneamente. Con el proxy de Vite, definir `TRUST_PROXY=loopback` en `.env` para que el límite de peticiones identifique al cliente. `WEB_ORIGIN` permite un solo origen exacto; configurar el origen real si cambia el puerto.

## Configuración

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | PostgreSQL local para Prisma/API/CLI; nunca imprimirla en logs |
| `JWT_SECRET` | Secreto aleatorio de al menos 48 bytes; el generador usa 48 bytes aleatorios en hex |
| `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` | Inicialización de PostgreSQL Compose |
| `POSTGRES_PORT` | Puerto local DB (5432); si cambia, ajustar también `DATABASE_URL` |
| `PORT`, `WEB_PORT` | API (3000) y frontend Compose (8080) |
| `WEB_ORIGIN` | Origen frontend local (5173); Compose lo adapta a `WEB_PORT` |
| `TRUST_PROXY` | Proxies confiables de Express para `X-Forwarded-For` (`loopback`, `uniquelocal`, CIDR o número de saltos; nunca `true`). Compose usa `uniquelocal`: Nginx sobrescribe la cabecera con la IP real y el límite se aplica por cliente |
| `COURSE_STORAGE_ROOT`, `SUBMISSION_STORAGE_ROOT` | Raíz de archivos de cursos y de entregas (Compose: volumen `/app/storage`) |
| `REGISTRY_URL`, `REGISTRY_API_KEY`, `REGISTRY_RETRY_BASE_MS` | Registro Académico (**SIMULADO** en Compose) y base del backoff de los 3 reintentos; sin URL y clave la sincronización queda inactiva |
| `APP_DB_PASSWORD`, `WEB_TLS_PORT` | Contraseña del rol de BD de mínimo privilegio `edutrack_app` (Compose) y puerto HTTPS (8443) |
| `AUDIT_ANCHOR_DIR`, `AUDIT_ANCHOR_INTERVAL_MS` | Directorio (volumen separado) y periodo del anclaje del último hash de auditoría |
| `ALERT_INTERVAL_MS`, `MONITOR_P95_MS`, `MONITOR_ERROR_RATE_PCT`, `MONITOR_OUTBOX_AGE_SECONDS`, `INSTANCE_ID` | Alertas operativas, umbrales del panel de monitoreo e identificador de réplica |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | SMTP y remitente: localhost:1025 por defecto, mailpit:1025 en Compose |
| `SMTP_SECURE`, `SMTP_REQUIRE_TLS` | TLS implícito / STARTTLS; obligatorio para host remoto |
| `SMTP_USER`, `SMTP_PASSWORD` | Autenticación opcional; configurar juntos solo en entorno |

`.env.example` documenta las claves sin secretos válidos. En producción suministrar secretos desde el entorno/gestor y un certificado institucional. Compose simula la topología (2 réplicas, TLS, rol mínimo) en una sola máquina; no certifica disponibilidad ni concurrencia institucional. No publicar sus puertos a Internet.

## API implementada

| Método | Ruta | Permiso / resultado |
| --- | --- | --- |
| POST | `/api/identity/login` | `{email,password}` → token de 15 min y perfil; 5 intentos/min/IP |
| GET | `/api/identity/me` | Bearer JWT válido; perfil actual desde BD |
| PATCH | `/api/identity/me` | Perfil propio: displayName y version |
| POST | `/api/identity/logout` | Revocación persistida de sesión actual; 204 |
| POST | `/api/identity/users` | ADMIN; `{email,displayName,password,role}` → 201 |
| GET | `/api/identity/users?limit=25&offset=0` | ADMIN; paginación, máximo 100 |
| PATCH | `/api/identity/users/:id` | ADMIN; email, displayName, role, active, version |
| POST | `/api/identity/password/change` | currentPassword, newPassword; cierra todas las sesiones |
| POST | `/api/identity/password/recovery` | email; 202 genérico, sin token ni revelación de existencia |
| POST | `/api/identity/password/reset` | token y password; un uso, 15 minutos |
| GET | `/api/identity/security-events` | ADMIN; registro paginado de seguridad |
| GET | `/api/health/live` | Liveness del proceso |
| GET | `/api/health/ready` | Conectividad con BD, 503 si falla |
| * | `/api/courses/...` | Cursos, contenidos, historial y avance: ver [CURSOS.md](docs/CURSOS.md) |
| * | `/api/exams/...` | Rendir cuestionarios, autoguardado y finalización: ver [EXAMENES.md](docs/EXAMENES.md) |
| * | `/api/assessments/...`, `/api/grading/...`, `/api/audit/...` | Banco, evaluaciones, notas y auditoría: ver [EVALUACIONES.md](docs/EVALUACIONES.md) |
| GET/POST | `/api/enrollments/courses/:id[/roster]` | ADMIN; inscritos y conciliación de la lista oficial ([ADR-007](docs/ADR/007-proyeccion-matriculas-cierre-fase3.md)) |
| GET / POST | `/api/enrollments/registry` · `/api/enrollments/registry/sync` | ADMIN; estado del registro SIMULADO e historial / «Sincronizar ahora» (409 si hay otra en curso) |
| POST / GET | `/api/submissions/assessments/:id` · `.../me` · `/api/submissions/files/:fileId` | Estudiante inscrito: entregar o reemplazar (multipart `file`) y ver su entrega; docente responsable/ADMIN: listado y descarga |
| GET | `/api/plagiarism/assessments/:id` | Docente responsable o ADMIN; informes de similitud (proveedor SIMULADO) |
| GET | `/api/administration/monitoring?minutes=15` | ADMIN; panel de rendimiento y operación |
| GET | `/api/audit/anchors/verify` | ADMIN; compara los anclajes externos con la cadena de auditoría |

DTO estrictos; 400 inválido, 401 credenciales/token/sesión, 403 permiso, 409 duplicado/versión/último ADMIN, 429 límite. Perfiles sin credenciales. JWT identifica usuario y sesión; rol/estado se obtienen de BD. Token en memoria del navegador; recargar requiere nuevo acceso. **Logout revoca la sesión en servidor**. Cambios de acceso o contraseña revocan las sesiones afectadas. Se protege al último ADMIN activo incluso con cambios simultáneos. El limitador HTTP sigue en memoria por instancia; almacenamiento compartido y proxy confiable pendientes antes de escalar. [API completa](docs/IDENTIDAD_API.md) y [ADR-005](docs/ADR/005-identidad-completa.md).

## Recuperación por correo

Compose incluye **Mailpit**, servidor SMTP local con bandeja en **http://localhost:8025** y SMTP en 1025. Recibe mensajes reales y los captura; **no los reenvía a buzones de Internet**. No usarlo como proveedor de producción ni exponerlo públicamente. En desarrollo iniciar `db mailpit`; el enlace apunta al `WEB_ORIGIN` configurado (5173 en Vite, 8080 en Compose).

En «Olvidé mi contraseña», solicitar el enlace para una cuenta activa y abrir el mensaje en Mailpit. Es válido 15 minutos, de un solo uso y permite elegir una contraseña nueva. La SPA lee/elimina el fragmento de la dirección. Todas las sesiones anteriores quedan revocadas. Cuentas desconocidas/inactivas reciben la misma respuesta genérica. Cooldown 60 s por cuenta y 3 solicitudes/min/IP.

Cola cifrada en PostgreSQL, consumidor dentro del mismo backend cada 2 s, hasta 5 intentos SMTP con backoff. El ADMIN ve los fallos en Eventos de seguridad; aceptación SMTP no garantiza llegada al buzón final de un proveedor remoto. Para producción configurar SMTP autenticado/TLS y HTTPS público. Ver ADR-005 para límites y rotación de secretos.

## Pruebas

```sh
npm run check
```

Incluye generación Prisma, tipos, build, pruebas unitarias, frontend y límites de arquitectura. Integración usa una **base desechable explícita**, sin fallback al volumen de desarrollo:

```powershell
$env:TEST_DB_PASSWORD = node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('hex'))"
$env:TEST_DATABASE_URL = "postgresql://edutrack_test:$($env:TEST_DB_PASSWORD)@localhost:55432/edutrack_test?schema=identity"
docker compose -f compose.test.yaml up -d --wait
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npm run db:migrate
npm run test:integration
docker compose -f compose.test.yaml down
Remove-Item Env:DATABASE_URL,Env:TEST_DATABASE_URL,Env:TEST_DB_PASSWORD
```

En Bash: generar `TEST_DB_PASSWORD` con Node, exportar `TEST_DATABASE_URL` con la misma URL/puerto y ejecutar la migración con `DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate`. La base de pruebas vive en tmpfs; detener su contenedor la descarta. CI ejecuta los mismos tests contra un servicio PostgreSQL real. Carga: `npm run test:load` (un proceso) o, con 2 réplicas y caída de una, el modo Compose descrito en [PRUEBAS_CARGA.md](docs/PRUEBAS_CARGA.md) (`compose.loadtest.yaml`, siempre contra `edutrack_test`).

Integración de fase 2 requiere Mailpit SMTP/API en 1025/8025: `docker compose up -d mailpit --wait`. CI lo proporciona como servicio real. Con Compose y compilación local, `npm run test:smoke` verifica SPA, Nginx, alta/listado, permisos y revocación al salir. Crea y elimina solo sus cuentas temporales.

Prueba en navegador real, con Compose actualizado y `.env` local apuntando a su PostgreSQL:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.tools\playwright"
npx.cmd playwright install chromium
$env:COURSES_E2E = 'true'; $env:ASSESSMENTS_E2E = 'true'
npm.cmd run test:e2e
# esperar > 60 s (login limitado por IP) antes de:
npm.cmd run test:smoke
```

El E2E y el smoke usan https://localhost:8443 (certificado autofirmado aceptado solo en estas pruebas locales). Con las variables académicas, el E2E recorre también la entrega de una tarea y su informe SIMULADO, la sincronización con el registro SIMULADO (correcta y con caída, alerta incluida) y el panel de monitoreo. Usa `REGISTRY_API_KEY` del `.env` para preparar la sección en el simulador.

## Operación (local)

```sh
node scripts/db-backup.mjs backup                 # backups/edutrack-<UTC>.dump + .sha256 (fuera de Git)
node scripts/db-backup.mjs verify backups/<archivo>.dump   # restaura en una BD temporal, compara conteos y verifica la auditoría
node scripts/db-backup.mjs restore backups/<archivo>.dump --yes   # reemplaza la base viva: detener api/api2 antes
```

Registro SIMULADO: `PUT http://localhost:4010/admin/mode` con `{"mode":"down"}` o `{"failNext":2}` (cabecera `X-Registry-Key`) para demostrar reintentos y alertas; `{"mode":"up"}` lo restablece. Panel: menú ADMIN «Monitoreo» y «Registro académico».

Requiere `npm run build`. Cubre administración, roles, perfil responsivo, logout y correo/recuperación hasta el acceso nuevo. Crea cuentas únicas de QA y elimina solo esas cuentas; no usar contra producción. Screenshots en `tmp/screens/`, fuera de Git. CI ejecuta unitarias/arquitectura e integración; Chromium se verifica localmente.

## Alcance de esta entrega

Implementados CAR-13/CU-13 para esta fase: alta/listado/edición administrativa, cuatro roles, activación/desactivación, perfil editable, acceso/salida revocable, cambio/recuperación de contraseña, eventos de seguridad y panel por rol. Registro administrativo, sin alta pública abierta. Cada cuenta tiene un rol. CLI solo para el primer ADMIN.

Cursos/Contenidos: CAR-01/02/03 implementados en un contexto académico cohesivo (ADR-006/007), con State (transiciones, editabilidad y visibilidad), Composite (avance y duración), sílabo, unidades/sesiones con duración, orden, eliminación en borradores nunca publicados, archivos/versiones, historial de cambios de solo inserción, revisión/aprobación y progreso por estudiante. No se ha avanzado a Evaluaciones. Ver [guía de Cursos](docs/CURSOS.md), [OpenAPI](docs/openapi.json), [diagramas](docs/diagrams/CURSOS.md), [plan](docs/PLAN_DESARROLLO.md) y [verificación](docs/VERIFICACION.md).

Docentes gestionan solo cursos propios; diseñador aprueba/rechaza; ADMIN administra; estudiantes solo publicado+matriculado. La inscripción proviene de la **lista oficial** del Registro Académico, guardada como proyección persistida (`enrollments`). Hasta que exista el adaptador CAR-09, el ADMIN la sincroniza por curso en «Inscritos»; sin inscripción activa el estudiante no ve el curso. Archivos en volumen `edutrack_course_files`, máximo 25 MiB; PDF/DOCX/PPTX/TXT/MP4/WebM. No borrar volúmenes al actualizar. Para editar publicado, volver explícitamente a borrador: deja de ser visible hasta nueva aprobación.

Evaluaciones (fase 4, [ADR-008](docs/ADR/008-evaluaciones-calificacion-auditoria.md)): banco de preguntas, evaluaciones con snapshot inmutable y sorteo, calificación por rúbrica (Strategy), promedios ponderados 0–20 y auditoría inmutable con hash encadenado para notas y evaluaciones publicadas; consulta y verificación por ADMIN.

Exámenes (fase 5, [ADR-009](docs/ADR/009-examenes-concurrentes.md), [EXAMENES.md](docs/EXAMENES.md)): intento contra reloj con vencimiento del servidor, autoguardado idempotente con ACK tras commit, reconexión con cola local, cierre por tiempo y calificación automática auditada vía outbox.

Colaboración y analítica (fase 8, [ADR-010](docs/ADR/010-colaboracion-analitica.md)): foros por curso/unidad con moderación, notificaciones (respuestas, vencimientos, notas) y panel de seguimiento con riesgo explicable por reglas.

Pendientes: S3/antivirus/conciliación y retención de archivos, adaptador SOAP/REST de matrículas (CAR-09), conexión/riesgo y resto del plan. TLS producción, MFA/SSO, refresh y límite distribuido siguen como mejoras operativas. Ramas: `main` contiene solo la fase 1; fase 2 en `feat/identity-complete`, fase 3 en `feat/courses-content` y su cierre posterior a la auditoría en `fix/fase3-cierre`. Ninguna se fusiona automáticamente; la fase 4 debe partir de la rama de cierre o de `main` una vez integradas.
