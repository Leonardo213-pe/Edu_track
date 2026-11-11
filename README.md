# EduTrack LMS

Primera entrega: base de **arquitectura hexagonal y monolito modular** con identidad operativa. Un backend NestJS, frontend React y PostgreSQL; Prisma permanece dentro del adaptador. No hay integraciones externas activas ni funcionalidades académicas simuladas.

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

La CLI es una herramienta privilegiada para el operador con acceso al entorno. No es un endpoint sin autenticación. Las altas posteriores se hacen desde el panel como administrador. Roles: `STUDENT`, `TEACHER`, `INSTRUCTIONAL_DESIGNER`, `ADMIN`. Conservar la contraseña inicial por un canal institucional seguro; cambio/recuperación/autoservicio están pendientes.

## Desarrollo local

```sh
npm ci
npm run setup:env  # una sola vez
docker compose up -d db --wait
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

`.env.example` documenta las claves sin secretos válidos. En producción suministrar secretos desde el entorno/gestor, usar TLS ≥1.2, roles de BD de privilegios mínimos y migraciones mediante tarea de despliegue. Compose es un entorno local de una réplica; no certifica disponibilidad ni concurrencia institucional. No publicar sus puertos a Internet.

## API implementada

| Método | Ruta | Permiso / resultado |
| --- | --- | --- |
| POST | `/api/identity/login` | `{email,password}` → token de 15 min y perfil; 5 intentos/min/IP |
| GET | `/api/identity/me` | Bearer JWT válido; perfil actual desde BD |
| POST | `/api/identity/users` | ADMIN; `{email,displayName,password,role}` → 201 |
| GET | `/api/identity/users?limit=25&offset=0` | ADMIN; paginación, máximo 100 |
| GET | `/api/health/live` | Liveness del proceso |
| GET | `/api/health/ready` | Conectividad con BD, 503 si falla |

DTO estrictos; 400 inválido, 401 credenciales/token, 403 rol, 409 duplicado, 429 límite. Los perfiles no contienen hash ni contraseña. JWT solo identifica al usuario; el rol se obtiene de BD en cada petición. El navegador conserva el token en memoria; recargar/cerrar sesión lo elimina. Logout local no revoca un token robado: caduca en 15 minutos. Límite de peticiones en memoria por instancia; almacenamiento distribuido y configuración de proxy confiable quedan pendientes antes de escalar. Las peticiones al mismo proxy local comparten límite por IP; no confiar ciegamente en `X-Forwarded-For`.

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

Con Compose levantado y la compilación local disponible, `npm run test:smoke` comprueba CLI, SPA, Nginx, autenticación, alta/listado y denegación por rol. Crea cuentas temporales y elimina únicamente sus propios registros al terminar. No modifica cuentas existentes.

## Alcance de esta entrega

Implementados acceso, perfiles, cuatro roles, alta/listado administrativo, aprovisionamiento CLI, persistencia real, interfaz responsiva, Docker y CI. CAR-13/CU-13 está **parcial**: edición/baja de usuarios, cambios de rol, recuperación/cambio de contraseña, revocación y MFA no están implementados. No hay registro público.

Los otros trece módulos tienen carpetas y responsabilidades documentadas, sin controladores/adaptadores ficticios. Cursos, matrícula, exámenes, autoguardado, calificación, auditoría inmutable, archivos, foros, analítica, plagio y monitoreo completo quedan pendientes. Ver el [plan incremental](docs/PLAN_DESARROLLO.md). No se ha desplegado a nube ni fusionado con `main`.
