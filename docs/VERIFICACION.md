# Verificación de EduTrack LMS

## Etapa 3: Cursos y contenidos, 11 de noviembre de 2026

Base publicada `feat/identity-complete`, commit `7392460`. Rama `feat/courses-content`; PR apilado contra esa base, sin fusionar main. Antes de modificar se revisaron AGENTS, arquitectura, plan, identidad y páginas 4-12 del informe original. Baseline: compilación/suites existentes correctas y 13 integraciones de identidad aprobadas.

| Verificación ejecutada | Resultado observado |
| --- | --- |
| `npm run generate`, tipos y build | Clientes aislados de identidad/cursos y aplicación única compilados |
| `npm run check` final | Código 0: generación, TypeScript, build, backend/frontend y arquitectura |
| Backend | **50/50** pruebas; incluyen 34 de fase anterior y 16 nuevas de State/Composite/casos de uso |
| Frontend | **9/9**, regresión de identidad y alta académica/permisos/avance de UI con doubles de fetch explícitos |
| Arquitectura AST | **4/4**, dependencias del núcleo, límites públicos, módulos y grafo sin ciclos |
| Integración real | **20/20**: 13 de identidad + 7 de Cursos, contra PostgreSQL 17, SMTP y sistema de archivos reales |
| Chromium real, `COURSES_E2E=true npm run test:e2e` | **1/1** recorrido combinado: identidad/recuperación, curso/sílabo/unidad/sesión, subida TXT, aprobación por diseñador, visor, progreso estudiantil y móvil |
| Core total V8 | Líneas **97,73% (216/221)**, ramas **96,11% (297/309)**, funciones **97,47% (116/119)**, statements **97,22% (420/432)** |
| Core Cursos V8 | Dominio y aplicación **100% de líneas**, ramas dominio 98,82% y aplicación 95,14% |
| Migraciones | `202611110002_courses` aplicada realmente en DB aislada y Compose, conservando identidad |
| Docker | API/web/PostgreSQL/Mailpit saludables, volumen privado de archivos creado y probado |
| OpenAPI | JSON 3.1.0 válido sintácticamente, 16 rutas documentadas (13 académicas + 3 de entrada de identidad); no se presenta como validación externa de todos los esquemas |

Total **84 pruebas** (50+9+4+20+1), sin sumar el smoke como si fuera una suite de casos. Se repitió integración tras ajustar mapeo para no serializar claves de relación privadas. El control de tipos, build y pruebas de fases anteriores sigue pasando. CI remoto de este PR no se afirma ejecutado en este registro local.

Integración académica verifica creación/inválidos/asignación de docente, edición de estructura/orden con restricciones diferibles, conflicto de revisión y duplicados, bytes/hash reales y conservación de archivos previos, trigger contra UPDATE de versiones, rechazo de archivo disfrazado, revisión/rechazo con observaciones/publicación, permisos sin actor/rol del body, borradores/cursos ajenos/matrículas ausentes, idempotencia de completitud, progreso 50%/0% tras versionar, retirada al reabrir y bloqueo al archivar. Esos ensayos usan el adaptador explícito de fixtures de EnrollmentAccess, no una conexión SOAP/REST institucional.

Se inspeccionaron capturas de docente y estudiante móvil (390 px): contenido visible sin desbordamiento. El visor TXT cargó bytes descargados por un endpoint autenticado; se adaptó CSP para permitir `blob:` solo en frame/media, sin habilitar scripts externos. Descarga autorizada preserva las versiones anteriores para personal y limita a vigente para estudiantes.

Alcance y límites: CAR-01/02/03 implementados en el contexto cohesivo courses (ADR-006). Sílabo es valor del curso; materiales/revisión no se duplican en espacios reservados. Matrícula real todavía pendiente, denegación por defecto y fixtures solo con habilitación explícita. Almacenamiento local operativo; S3/antivirus/conciliación de huérfanos/rangos de video pendientes. No se ejecutaron pruebas de carga/failover/TLS de producción ni se implementaron Evaluaciones. Datos/cursos/archivos propios de QA se limpiaron; volumen y cuentas de usuario conservados.

Detalles de uso/endpoints/pendientes en CURSOS.md, OpenAPI y ADR-006. Se deshabilitan los fixtures de QA al terminar. El PR se prepara para revisión; no se fusiona ninguna rama ni se despliega a nube.

## Fase 2: identidad completa, 11 de noviembre de 2026

Rama de revisión `feat/identity-complete`, derivada de `main`. Cambios sin merge, commit ni push automático. El informe original y los trece módulos académicos/operativos pendientes no se modificaron. Migración aditiva `202611110001_identity_complete`: cuentas existentes activas/versión 0, nuevas sesiones/recuperaciones/outbox y eventos propios de identidad. JWT previos sin sesión `jti` requieren volver a iniciar sesión.

| Verificación realmente ejecutada | Resultado |
| --- | --- |
| `npm ci --no-fund` y posteriores builds Docker con `npm ci` | Instalación reproducible del lockfile, sin errores |
| `npm run check` | Generación Prisma, tipos, build backend/frontend y suites completas: código 0 |
| Backend unitario/criptografía | **34/34** pruebas aprobadas |
| Frontend con Testing Library | **7/7**, incluidos logout remoto, recuperación, perfil, edición de rol/estado y regresión de enlace en pestaña existente; fetch identificado como doble |
| Arquitectura AST | **4/4**, núcleo sin frameworks/ORM, límites de módulos y grafo sin ciclos |
| Cobertura de dominio/aplicación implementados | Líneas **100% (108/108)**, funciones **100% (37/37)**, ramas **98,29% (115/117)**, statements **98,76% (160/162)** |
| Migraciones sobre PostgreSQL 17 desechable | Las dos migraciones aplicadas en `edutrack_test`, puerto 55432; sin fallback a desarrollo |
| Integración HTTP/Nest compilado/Prisma/PostgreSQL/SMTP | **13/13**; envío real aceptado por Mailpit y contenido consultado por su API |
| `npm run test:e2e` con Chromium real | **1/1**, recorrido conectado a Compose y PostgreSQL: cuenta, rol, perfil móvil sin desborde, salida, recuperación por correo y nuevo acceso |
| `npm run test:smoke` | Recorrido HTTP real de SPA/Nginx/API/PostgreSQL y logout revocable; cuentas propias limpiadas |
| `docker compose up --build -d --wait` | API, web, db y mailpit saludables; migración aplicada sin borrar volumen existente |
| Auditoría npm tras Nodemailer 10.5.0 y Playwright | **0 vulnerabilidades** reportadas en la instalación final |
| `git diff --check` | Sin errores de espacios; `.env`, `.tools`, resultados y screenshots ignorados |

Son **59 pruebas automatizadas** (34+7+4+13+1), más el smoke HTTP. La cobertura no incluye módulos inexistentes ni certifica rendimiento de exámenes. CI contiene servicios PostgreSQL/Mailpit reales; su ejecución remota de esta rama no se ha solicitado/observado. Chromium se ejecutó localmente; no se certificó matriz completa Safari/Firefox/Edge.

Casos de integración: credenciales correctas/incorrectas/desconocidas/inactivas, JWT manipulado/vencido por sesión, endpoints sin autenticación, permisos de los cuatro roles, edición persistida y versiones obsoletas, inyección de rol por perfil, correos duplicados concurrentes, último ADMIN protegido bajo dos degradaciones simultáneas, logout/cambio de rol/baja/reactivación, cambio de contraseña con verificación anterior, recuperación de un uso/caducidad/consumo concurrente, revocación de sesiones, fallo SMTP retenido para reintento y eventos de seguridad que rechazan UPDATE/DELETE.

El navegador detectó una incidencia real: cambiar solo el fragmento de un enlace de recuperación en la pestaña abierta conservaba el estado anterior del formulario. Se corrigió escuchando `hashchange` y reiniciando la vista por token; se añadió regresión y el recorrido completo se repitió con éxito. Se revisaron capturas de login, administración y perfil móvil (1440 px/390 px), sin recortes ni desbordes observados. Chromium se descargó a `.tools/playwright`, fuera de Git.

Mailpit es un servidor SMTP real de desarrollo que captura mensajes y **no entrega a Internet**. No se probó un proveedor productivo ni se incorporaron credenciales de terceros. SMTP remoto exige TLS. EAC-05 cubierto en identidad/RBAC; cursos/secciones y terminación HTTPS/TLS de producción siguen dependiendo de etapas posteriores. Registro de seguridad de identidad no se presenta como auditoría académica CAR-12.

Pendientes operativos: proveedor SMTP productivo, TLS/ingress, rate limiter compartido para múltiples réplicas, política de retención de sesiones/eventos/outbox, y opcionalmente MFA/SSO/refresh. No se ejecutaron carga, failover, integración de matrículas/plagio ni despliegue a nube. Las cuentas temporales de QA se eliminan; no se deja una contraseña predeterminada. Web en `localhost:8080`, bandeja SMTP en `localhost:8025`; primer ADMIN por CLI según README.

## Histórico: primera entrega (antes de fase 2)

Sesión local del 10 al 11 de noviembre de 2026, America/Lima. Entorno Windows/PowerShell, Node 24.22.2 portátil con SHA-256 cotejado contra el manifiesto oficial de nodejs.org, npm 11.19.1, Docker Engine 29.8.2 y Compose 5.6.0. No se modificó la instalación global de Node ni el PostgreSQL existente en 5432.

## Resultados ejecutados

| Comando / prueba | Resultado observado |
| --- | --- |
| `npm install` con manifiestos finales | Dependencias/lockfile actualizados, **0 vulnerabilidades** reportadas por npm audit en esa ejecución |
| `npm run generate` | Prisma 7.10.1 genera cliente aislado en adaptador identity |
| `npm run typecheck` | Backend y frontend sin errores TypeScript |
| `npm run build` | Backend compilado y SPA Vite 7.3.8 generada |
| `npm run check` | Completo, código de salida 0: generación, tipos, build y suites |
| Unitarias backend con Vitest 5.1.0 | **26/26**: invariantes, casos de uso/permisos, scrypt real y JWT real |
| Cobertura del núcleo implementado | **100%** líneas (37/37), ramas (38/38), funciones (13/13), statements (52/52); tres archivos con comportamiento, un archivo de interfaces omitido por vacío |
| Frontend con Vitest/Testing Library | **2/2**: acceso/perfil/cierre y rechazo de credenciales; fetch es un doble de prueba explícito |
| `npm run test:architecture` | **4/4**: imports, ejemplos prohibidos, hexágonos por módulo y grafo previsto sin ciclos |
| `npm run db:migrate` en DB de pruebas | Migración aplicada realmente en PostgreSQL 17 aislado, base `edutrack_test`, puerto 55432 |
| `npm run test:integration` | **7/7** contra Nest compilado, Prisma y PostgreSQL reales, sin repositorio en memoria |
| Construcción y arranque Compose | Imágenes construidas con `npm ci`; API aplica migración y arranca; db/api/web saludables |
| `npm run test:smoke` | SPA HTTP 200, readiness, CLI real, login, perfil seguro, alta/listado y rechazo 403 a estudiante mediante Nginx/API/DB reales; cuentas propias eliminadas |
| Estado Git | Rama `feat/initial-foundation`, sin commits/merge/push automáticos |

Integración verifica perfil sin hash, JWT manipulado/ausente, cuatro roles, rechazo de administración a los tres roles no ADMIN, DTO estricto, paginación, unicidad bajo dos altas simultáneas, rol actualizado desde persistencia y rate limiting. No usa proveedores externos ni presenta respuestas simuladas como una integración.

## Incidencias detectadas y resueltas

- El sandbox bloqueaba el acceso de esbuild al resolver rutas y la comunicación con Docker; las verificaciones se ejecutaron con acceso autorizado fuera de esa restricción.
- Puerto 5432 ocupado: solo el `.env` local de EduTrack pasó a 5433; el otro servicio no se detuvo.
- Primera ejecución de Prisma compilado falló por imports `.ts`: se configuró extensión `.js`, se regeneró y se repitieron integración y arranque.
- Debian slim no incluía OpenSSL: añadido a la imagen API, reconstruida y arrancada.
- Primera prueba de arquitectura clasificó la configuración técnica de raíz como módulo ajeno: corregida para distinguir otros módulos de configuración; los ejemplos de imports privados prohibidos siguen fallando como se espera.
- Vitest 3 evaluado inicialmente tenía avisos de seguridad: sustituido por 5.1.0, ajustadas aserciones frontend y repetidos tipos/build/pruebas con el lockfile final.

## Límites de la evidencia

No se ejecutó CI en GitHub: se añadió el workflow y sus comandos se comprobaron localmente; su primera ejecución remota queda pendiente. No se ejecutó matriz real de navegadores ni revisión visual automatizada de todas las pantallas. La SPA se compiló, se probó con DOM simulado y se sirvió realmente vía Nginx.

La cobertura corresponde únicamente al código existente de dominio/aplicación de identidad, no a todo el LMS ni al frontend/adaptadores. No hay pruebas de carga ejecutadas, certificación de 3.000 concurrentes, alta disponibilidad, TLS producción, Redis/SQS/S3, proveedores de plagio, legado SOAP/REST o despliegue a nube. Exámenes, notas y auditoría inmutable son diseño pendiente. El informe fuente conserva sus supuestos, no se convierten en resultados.

Los servicios de desarrollo quedan accesibles en web `localhost:8080`, API `localhost:3000`, PostgreSQL `localhost:5433`. `.env` contiene secretos locales aleatorios y está ignorado por Git. No queda una cuenta predeterminada; para entrar crear el primer administrador siguiendo README. Base de integración temporal detenida después de la verificación.
