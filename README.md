# EduTrack LMS

Etapa 3: **cursos y contenidos académicos**, integrada con autenticación/usuarios/roles de fase 2. Arquitectura hexagonal y monolito modular: un backend NestJS, React y PostgreSQL; Prisma solo en adaptadores. Archivos reales, versiones, revisión instruccional y completitud. El correo usa SMTP real; no hay contenidos simulados sustituyendo funcionalidades.

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

`setup:env` crea secretos aleatorios en `.env` y se niega a sobrescribirlo. No hay cuentas o contraseñas predeterminadas. Acceso web: **http://localhost:8080**. API: http://localhost:3000/api. Compose aplica las migraciones versionadas antes de iniciar la API. El volumen `edutrack_postgres_data` conserva los datos; `docker compose down` detiene el entorno sin borrarlos.

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

Web en http://localhost:5173 con proxy a la API 3000. `dev:api` observa JavaScript compilado; tras editar TypeScript ejecutar `npm run build -w @edutrack/api` o `npx tsc -p apps/api/tsconfig.build.json --watch` en otra terminal. No ejecutar la API local y la API Compose en el mismo puerto simultáneamente. `WEB_ORIGIN` permite un solo origen exacto; configurar el origen real si cambia el puerto.

## Configuración

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | PostgreSQL local para Prisma/API/CLI; nunca imprimirla en logs |
| `JWT_SECRET` | Secreto aleatorio de al menos 48 bytes; el generador usa 48 bytes aleatorios en hex |
| `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` | Inicialización de PostgreSQL Compose |
| `POSTGRES_PORT` | Puerto local DB (5432); si cambia, ajustar también `DATABASE_URL` |
| `PORT`, `WEB_PORT` | API (3000) y frontend Compose (8080) |
| `WEB_ORIGIN` | Origen frontend local (5173); Compose lo adapta a `WEB_PORT` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | SMTP y remitente: localhost:1025 por defecto, mailpit:1025 en Compose |
| `SMTP_SECURE`, `SMTP_REQUIRE_TLS` | TLS implícito / STARTTLS; obligatorio para host remoto |
| `SMTP_USER`, `SMTP_PASSWORD` | Autenticación opcional; configurar juntos solo en entorno |

`.env.example` documenta las claves sin secretos válidos. En producción suministrar secretos desde el entorno/gestor, usar TLS ≥1.2, roles de BD de privilegios mínimos y migraciones mediante tarea de despliegue. Compose es un entorno local de una réplica; no certifica disponibilidad ni concurrencia institucional. No publicar sus puertos a Internet.

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

En Bash: generar `TEST_DB_PASSWORD` con Node, exportar `TEST_DATABASE_URL` con la misma URL/puerto y ejecutar la migración con `DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate`. La base de pruebas vive en tmpfs; detener su contenedor la descarta. CI ejecuta los mismos tests contra un servicio PostgreSQL real. [Plan de carga](docs/PRUEBAS_CARGA.md): escenarios EAC-01/02/03, todavía pendientes del módulo de exámenes.

Integración de fase 2 requiere Mailpit SMTP/API en 1025/8025: `docker compose up -d mailpit --wait`. CI lo proporciona como servicio real. Con Compose y compilación local, `npm run test:smoke` verifica SPA, Nginx, alta/listado, permisos y revocación al salir. Crea y elimina solo sus cuentas temporales.

Prueba en navegador real, con Compose actualizado y `.env` local apuntando a su PostgreSQL:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.tools\playwright"
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

Requiere `npm run build`. Cubre administración, roles, perfil responsivo, logout y correo/recuperación hasta el acceso nuevo. Crea cuentas únicas de QA y elimina solo esas cuentas; no usar contra producción. Screenshots en `tmp/screens/`, fuera de Git. CI ejecuta unitarias/arquitectura e integración; Chromium se verifica localmente.

## Alcance de esta entrega

Implementados CAR-13/CU-13 para esta fase: alta/listado/edición administrativa, cuatro roles, activación/desactivación, perfil editable, acceso/salida revocable, cambio/recuperación de contraseña, eventos de seguridad y panel por rol. Registro administrativo, sin alta pública abierta. Cada cuenta tiene un rol. CLI solo para el primer ADMIN.

Cursos/Contenidos: CAR-01/02/03 implementados en un contexto académico cohesivo (ADR-006), con State/Composite, sílabo, unidades/sesiones, orden, archivos/versiones, historial, revisión/aprobación y progreso básico. No se ha avanzado a Evaluaciones. Ver [guía de Cursos](docs/CURSOS.md), [OpenAPI](docs/openapi.json), [diagramas](docs/diagrams/CURSOS.md), [plan](docs/PLAN_DESARROLLO.md) y [verificación](docs/VERIFICACION.md).

Docentes gestionan solo cursos propios; diseñador aprueba/rechaza; ADMIN administra; estudiantes solo publicado+matriculado. La sincronización institucional aún no existe: por defecto se deniega acceso estudiantil y los ensayos usan fixtures expresamente habilitados, documentados en CURSOS.md. Archivos en volumen `edutrack_course_files`, máximo 25 MiB; PDF/DOCX/PPTX/TXT/MP4/WebM. No borrar volúmenes al actualizar. Para editar publicado, volver explícitamente a borrador: deja de ser visible hasta nueva aprobación.

Pendientes: S3/antivirus/conciliación y retención de archivos, matrícula real, conexión/riesgo, evaluaciones y resto del plan. TLS producción, MFA/SSO, refresh y límite distribuido siguen como mejoras operativas. PR de `feat/courses-content` con base `feat/identity-complete`, para revisar solo la etapa 3 sin fusionar automáticamente ninguna rama.
