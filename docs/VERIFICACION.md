# Verificación de EduTrack LMS

## Cierre del proyecto (partes A, B y C), 11 de noviembre de 2026

Rama `feat/cierre-proyecto`, creada desde `main` tras fusionar por fast-forward `feat/fase8-colaboracion-analitica` (`21c1944`). Decisiones en [ADR-011](ADR/011-cierre-matriculas-tareas-operacion.md); resumen en [ENTREGA.md](ENTREGA.md). Durante el desarrollo se ejecutaron solo typecheck y pruebas unitarias en cada punto de guardado (commits `1ec46a5` parte A, `e1c78fd` parte B, `9788922` parte C). La verificación pesada se ejecutó **una vez al final**, en Windows 11 con Docker Desktop:

| Verificación ejecutada | Resultado observado |
| --- | --- |
| `npm run check` | Código 0: 12 clientes Prisma, tipos, build, pruebas y arquitectura |
| Backend unitario | **147/147**; cobertura V8 del núcleo (dominio + aplicación): statements 97,44 %, ramas 93,67 %, funciones 95,36 %, líneas 98,33 % |
| Frontend | **28/28** (registro académico, monitoreo, entrega del estudiante, entregas/similitud/rúbrica del docente y los anteriores) |
| Arquitectura AST | **7/7** con `submissions`, `plagiarism` y `administration`, grafo sin ciclos |
| `npm run db:migrate` en `edutrack_test` | 10 migraciones aplicadas en PostgreSQL 17 desechable (puerto 55432) |
| `npm run test:integration` | Primera ejecución: 45/48 — 3 fallos **de las propias pruebas** (orden textual de `id::text`, métricas compartidas entre suites, ranura de prueba > 40 caracteres). Corregidas las pruebas: las 2 suites afectadas 8/8 y luego la suite completa **48/48 en 9 archivos** (38 previas + 5 registro + 2 entregas/plagio + 3 operación) |
| `docker compose up -d --build --wait` | db, migrate (10 migraciones + «Role edutrack_app: least privilege verified»), api, api2, web (certificado autofirmado generado), registry y mailpit sanos; HTTPS 200 y HTTP → 301 |
| `npm run test:load` vía Nginx + 2 réplicas (`compose.loadtest.yaml`, BD desechable), caída de `api2` al 50 % | Primera ejecución abortada: HTTP 500 `TooManyConnections` (`max_connections` = 100 con 2 réplicas). Tras subir a 300: **2000/2000 HTTP 200** (todas al primer intento), **0 ACK perdidos**, p50 451 ms, p95 2318 ms, p99 2514 ms, 278,7 guardados/s, 200/200 calificados en 4,6 s; `api2` sana 13 s después de arrancarla |
| Línea base sin caída (mismo entorno) | 2000/2000 HTTP 200, 0 ACK perdidos, p50 374 ms, **p95 867 ms**, p99 1032 ms, 435 guardados/s, 200/200 calificados en 3,7 s |
| E2E Chromium (`COURSES_E2E`, `ASSESSMENTS_E2E`, `PLAYWRIGHT_BROWSERS_PATH=.tools/playwright`) | **1/1** en 1,9 min sobre HTTPS: fases 2-8 más entrega del estudiante, informe SIMULADO y descarga del docente, sincronización con el registro SIMULADO (correcta y con caída: 3 reintentos, ejecución fallida, alerta en la campana) y panel de monitoreo con 2/2 réplicas. La primera ejecución no arrancó porque faltaba la variable `PLAYWRIGHT_BROWSERS_PATH` |
| `npm run test:smoke` (tras > 60 s de ventana de login) | Código 0: TLS 1.1 rechazado y TLS 1.2 aceptado, HSTS, redirección 301, SPA, login, usuarios, rechazos 403, 2 réplicas con métricas, registro SIMULADO, anclajes válidos, el rol `edutrack_app` recibe *permission denied* en UPDATE/DELETE de auditoría y DDL, y límite de login con 429 |
| `node scripts/db-backup.mjs backup` y `verify` | Volcado de 143 011 bytes con SHA-256; restaurado en `edutrack_restore_check`: conteos iguales a la base viva, cadena de auditoría íntegra (26 entradas) y base temporal eliminada |

La integración nueva verifica:
- **Registro (proceso real del simulador por HTTP):** vínculo de la sección al crear el curso; altas, bajas e idempotencia con `source = REGISTRY_SYNC` y el actor de sistema; 403 a no ADMIN; 2 fallos transitorios superados con reintentos; caída con 3 reintentos, ejecución `FAILED`, proyección intacta, LMS operativo y alerta `SYSTEM_ALERT`; dos ejecuciones simultáneas (200 + 409); inmutabilidad de las ejecuciones y unicidad de la ranura.
- **Entregas y plagio:** versiones y evento en la misma transacción, 3 informes asíncronos (copia > 70 % con su fuente, texto distinto < 20 %), cola vacía, listado, descarga y nota con rúbrica; 403 a no inscritos, docente ajeno y estudiantes en el informe; archivos rechazados; triggers de inmutabilidad; `DEADLINE_PASSED` con el reloj de la BD.
- **Operación con el rol `edutrack_app`:** sin superusuario, propiedad ni DDL; *permission denied* en UPDATE/DELETE/TRUNCATE de auditoría y en el historial de migraciones; el anclaje coincide con la cabeza de la cadena y se verifica; métricas por plantilla de ruta (sin IDs) y panel ADMIN.

Incidencias:
- Vitest del frontend fallaba de forma intermitente con «failed to find the current suite» cuando la ruta del proyecto empezaba por `c:` en minúscula (dos instancias del módulo). Desde `C:\` funciona de forma estable.
- jsdom no entrega el archivo por `FormData` ni valida `required` con `user.upload`: el formulario de entrega lee el archivo del input.
- El limitador de peticiones es en memoria por réplica: el smoke necesita hasta 2 × 5 intentos para observar el 429 (documentado en ADR-011).

Límites: el registro académico y el proveedor de plagio son **SIMULADOS**; el TLS es autofirmado; las 2 réplicas y PostgreSQL corren en una sola máquina. La carga es de 200 estudiantes, no de 3000, y no certifica EAC-01 ni el 99,5 % de EAC-02. No se ejecutó CI remoto. La base de pruebas se detiene al terminar.

## Fase 8: foros, notificaciones y analítica, 15 de noviembre de 2026

Rama `feat/fase8-colaboracion-analitica`, creada desde `main` (`079d0af`). Decisiones en [ADR-010](ADR/010-colaboracion-analitica.md).

| Verificación ejecutada | Resultado |
| --- | --- |
| `npm run check` | Código 0 |
| Backend unitario | **115/115**; cobertura del núcleo: líneas 97,95 %, ramas 94,32 % |
| Frontend | **22/22** (campana, foros, panel de riesgo y los anteriores) |
| Arquitectura AST | **7/7** con `collaboration` y `analytics` |
| Integración (PostgreSQL desechable) | **38/38**, 3 de ellas nuevas: foro por unidad, notificaciones Observer, darse de baja de un hilo, moderación, trigger contra la edición de mensajes, hilo cerrado, bandeja; recordatorio único por estudiante (2 en varias ejecuciones) y aviso de nota; señal de actividad sin inflar los minutos, panel de riesgo y reglas persistidas |
| Compose | La API aplicó `202611150001_collaboration_analytics` sin borrar datos |
| E2E Chromium | **1/1**: fases 2-5, más foro creado por el docente, hilo publicado por el estudiante, notificación «Nuevo hilo» en la campana del docente y panel de riesgo |

Incidencias:
- VS Code sobrescribió `bootstrap.ts` con una versión abierta anterior. Se volvió a aplicar la composición.
- Se ajustaron tres expectativas mal calculadas en las pruebas (niveles de riesgo y el sorteo con `random` fijo).
- La prueba de `App` pasó a responder según la URL, porque la campana hace su propia consulta.

## Fase 5: exámenes contra reloj, 14 de noviembre de 2026

Rama `feat/fase5-examenes`, creada desde `feat/fase4-evaluaciones` (`8a08e08`). Decisiones en [ADR-009](ADR/009-examenes-concurrentes.md); guía en [EXAMENES.md](EXAMENES.md).

| Verificación ejecutada | Resultado observado |
| --- | --- |
| `npm run check` | Código 0 (7 clientes Prisma, tipos, build, pruebas) |
| Backend unitario | **103/103**: vencimiento del servidor, inicio solo para cuestionario publicado, validación de respuestas por tipo, versiones, idempotencia, cierre perezoso y por barredor, calificación solo de las sorteadas, `recordAutomatic` idempotente y concurrente, sorteo y clave de respuestas |
| Cobertura V8 del núcleo | Líneas **98,98%**, statements 98,46%, ramas 95,03%, funciones 97,57% |
| Frontend | **19/19**: reanudar reenviando solo lo local más nuevo, cola sin conexión con reenvío al reconectar, intento cerrado bloqueado con su nota |
| Arquitectura AST | **7/7** con `exams` |
| `npm run test:integration` (PostgreSQL 17 desechable) | **35/35** en dos ejecuciones seguidas: 13 identidad + 10 cursos + 2 proxy + 4 fase 4 + 6 fase 5 |
| `npm run test:load` (200 estudiantes × 10 guardados simultáneos) | 2000/2000 HTTP 200, **0 ACK perdidos**, p95 724 ms, p99 859 ms, 200/200 calificados en 5,3 s (local, no certifica EAC-01) |
| Compose | La API aplicó `202611140001_exams` sobre desarrollo sin borrar datos |
| E2E Chromium (`COURSES_E2E`, `ASSESSMENTS_E2E`) | **1/1**: fases 2-4 más cuestionario creado del banco, publicado, rendido por el estudiante (comenzar, responder, «Todas las respuestas guardadas», finalizar), nota automática 20, promedio 16 y lista de intentos del docente |

La integración de la fase 5 verifica:
- **Inicio:** tres inicios simultáneos crean un solo intento; las preguntas no incluyen `correct`; el vencimiento es exacto a la duración.
- **Versiones:** v1, v3, v2 atrasada y v3 duplicada; una ráfaga de 20 versiones desordenadas deja guardada la mayor.
- **Validación:** opción ajena 400; versión 0 400; otro estudiante 403.
- **Reinicio de la API a mitad del examen:** las respuestas confirmadas se conservan y el vencimiento no cambia.
- **Finalización:** idempotente, con un solo evento `AttemptFinalized.v1` en el outbox.
- **Rechazos tras finalizar:** guardado 409; triggers contra respuestas, reapertura y borrado.
- **Calificación:** automática de 10 (1 de 2 preguntas correcta), auditada como Sistema y con el outbox marcado como procesado.
- **Vencimiento:** con el reloj de la base, el guardado tardío devuelve 409; el barredor cierra con EXPIRED/TIMEOUT y califica lo guardado.
- **Concurrencia:** 50 guardados paralelos de dos estudiantes sin errores.

Incidencias:
- **Error de concurrencia real.** La integración y la ráfaga encontraron que un guardado concurrente devolvía 500: la rama `SELECT` de la misma sentencia no veía la fila confirmada por un reintento paralelo. Se corrigió leyendo el estado en una sentencia nueva y se repitió la integración dos veces.
- **Error del editor en `bootstrap.ts`.** VS Code no encontraba `tsconfig.json` y aplicaba decoradores estándar de TypeScript 5. Se añadió `apps/api/tsconfig.json`, que hereda la configuración de compilación, y quedó con 0 diagnósticos.
- **Estilo de las opciones del examen.** Los botones de opción heredaban el ancho de los campos; se corrigió la hoja de estilos y se repitió el E2E.
- **Datos de QA.** Las ejecuciones E2E y de carga dejaron intentos, notas y auditoría de QA, que son inmutables por diseño.
- **Pendiente:** carga de 3000 estudiantes y failover multi-réplica en un entorno representativo.

## Fase 4: evaluaciones, calificación y auditoría, 13 de noviembre de 2026

Rama `feat/fase4-evaluaciones`, creada desde `fix/fase3-cierre` (`0ffdd96`, publicada en GitHub), sin merge. Decisiones en [ADR-008](ADR/008-evaluaciones-calificacion-auditoria.md); guía en [EVALUACIONES.md](EVALUACIONES.md).

| Verificación ejecutada | Resultado observado |
| --- | --- |
| `npm run check` | Código 0: generación de 6 clientes Prisma, TypeScript, build de API y SPA, pruebas |
| Backend unitario | **90/90** (12 archivos): preguntas por tipo, State de evaluaciones, snapshot, pesos, sorteo, Strategy automática y de rúbrica, redondeo half-up, promedio ponderado, versiones con motivo, permisos y auditoría |
| Cobertura V8 del núcleo | Líneas **99,15% (590/595)**, statements 98,62%, ramas 95,51%, funciones 97,52% |
| Frontend | **16/16**: incluye vista y nota del estudiante, pregunta V/F, cambio de nota con versión y motivo, y auditoría con verificación |
| Arquitectura AST | **7/7** con los módulos `assessments`, `grading` y `audit` (sin dependencias no declaradas, sin tablas ajenas) |
| Migración `202611130001_assessments_grading_audit` en PostgreSQL desechable | Aplicada; `prisma migrate diff` sin deriva en los objetos nuevos |
| `npm run test:integration` | **29/29**: 13 identidad + 10 cursos y matrículas + 2 proxy + 4 de fase 4 |
| Compose (`docker compose up --build -d --wait`) | API aplicó la migración sobre desarrollo sin borrar datos; servicios saludables |
| `COURSES_E2E=true ASSESSMENTS_E2E=true npm run test:e2e` (Chromium) | **1/1**: fases 2‑3, más banco, pregunta V/F, evaluación por rúbrica (2 criterios), publicación, nota 16 cambiada a 14 con motivo, promedio del estudiante 8 (8,4) y auditoría ADMIN «Nota: 16 → 14» con cadena íntegra |
| `npm run test:smoke` | Aprobado |
| `npm audit` | 0 vulnerabilidades |

Las integraciones de la fase 4 verifican sobre PostgreSQL real:
- **Banco y snapshot:** banco restringido a su docente; snapshot de 3 preguntas que no cambia al editar el banco y rechaza UPDATE y DELETE.
- **Publicación:** un curso no publicado devuelve 409; los pesos de más de 100 % devuelven 400.
- **Vista del estudiante:** sin `correct`, sin banco y sin opciones.
- **Auditoría de evaluaciones:** la publicación y cada cambio de peso de una evaluación publicada se auditan con actor y antes/después; un cambio estructural de una publicada devuelve 409; no se puede borrar.
- **Cambios sin actor:** se rechazan por SQL tanto en evaluaciones como en notas.
- **Notas por rúbrica:**
  - Solo las registra el docente responsable (otro docente y el ADMIN reciben 403) y solo para inscritos.
  - Un cambio sin motivo devuelve 400; con una versión obsoleta, 409.
  - El alta y el cambio quedan auditados con valor anterior y nuevo.
  - No se pueden borrar.
- **Promedios:** 11 con 60 % de peso da final 6,6, redondeado a 7.
- **Mis notas:** sin el motivo interno.
- **Auditoría:** solo para ADMIN. Rechaza UPDATE, DELETE y TRUNCATE. La verificación es válida, detecta la entrada alterada tras desactivar el trigger y vuelve a ser válida al restaurarla.

Incidencias y límites:
- La primera integración falló con 429: siete usuarios iniciaban sesión desde una IP con el límite ya efectivo. La prueba ahora simula una IP por usuario detrás del proxy confiable y la base de pruebas se recreó.
- El E2E encontró un `<select>` sin nombre accesible propio; se añadió `aria-label`.
- La primera repetición del smoke inmediatamente después del E2E recibió 429 porque se había agotado la ventana de login desde la misma IP. Pasado el minuto, se aprobó.
- Las ejecuciones E2E dejaron en la base de desarrollo evaluaciones publicadas, notas y auditoría de QA, que son inmutables por diseño. Las cuentas, cursos, archivos e inscripciones de QA se eliminaron.
- No se implementaron exámenes contra reloj ni autoguardado (fase 5), ni el rol de BD sin privilegios ni el anclaje externo del hash.

## Cierre de fase 3 tras auditoría, 12 de noviembre de 2026

Rama `fix/fase3-cierre`, creada desde `feat/courses-content` (`7956bc6`), sin commits ni merge. La auditoría previa encontró:
- Limitador compartido detrás de Nginx.
- Estudiantes sin acceso real a los cursos (solo había fixtures).
- Historial incompleto.
- State y Composite parciales.
- Sin eliminación de elementos en borrador.
- Listados que recorrían todos los cursos y usuarios.
- Archivos que se recibían antes de autorizar.
- Prueba AST sin cobertura de la raíz ni de las tablas Prisma.

Las correcciones se describen en [ADR-007](ADR/007-proyeccion-matriculas-cierre-fase3.md).

| Verificación ejecutada | Resultado observado |
| --- | --- |
| `npm run check` | Código 0: generación de 3 clientes Prisma, TypeScript, build de API y SPA, pruebas |
| Backend unitario (Vitest 5.1) | **65/65** (7 archivos), incluidos State, Composite y duración, historial, eliminación, encapsulación, matrículas, directorio y `TRUST_PROXY` |
| Cobertura V8 del núcleo (dominio y aplicación) | Líneas **100% (356/356)**, statements 99,67% (609/611), ramas 96,77% (360/372), funciones 100% (207/207) |
| Frontend (Testing Library, fetch como doble explícito) | **12/12**, incluidas sincronización de inscritos, eliminación con revisión y confirmación, y ocultamiento tras una publicación |
| Arquitectura AST | **7/7**: además de las reglas previas, raíz de composición, imports reales frente a `modules.json` y tablas y SQL Prisma por esquema |
| Migraciones en PostgreSQL 17 desechable (`edutrack_test:55432`, tmpfs) | Las 4 aplicadas, incluida `202611120001_phase3_closure` |
| `prisma migrate diff` de la BD migrada frente a `schema.prisma` | Las tablas y columnas nuevas no generan deriva. Aparece deriva preexistente de fase 2 (nombres de índices y `ON UPDATE`) y la FK intencional `completions_material_fkey`; documentado en ADR-007, sin cambios |
| `npm run test:integration` (Nest compilado, Prisma, PostgreSQL, SMTP y disco reales) | **25/25**: 13 de identidad + 10 de cursos y matrículas + 2 de proxy |
| `docker compose up --build -d --wait` | db, api, web y mailpit saludables; la API aplicó `202611120001_phase3_closure` sobre la base de desarrollo sin borrar datos ni volúmenes |
| `COURSES_E2E=true npm run test:e2e` (Chromium real contra Compose) | **1/1** (1,3 min): identidad y recuperación; curso, sílabo, unidad eliminada, sesión de 90 min, subida TXT e historial; aprobación; estudiante sin acceso antes de la inscripción; sincronización por el ADMIN; visor, completitud y móvil sin desbordes |
| `npm run test:smoke` (Nginx real) | Aprobado: SPA, readiness, alta y listado, denegaciones, logout, conciliación denegada a estudiante y límite efectivo aunque se falsifique `X-Forwarded-For` |
| `npm audit` | 0 vulnerabilidades |

Las integraciones de cursos verifican:
- Altas, bajas, reactivación e idempotencia de la lista oficial; rechazo total con `UNKNOWN_STUDENTS`; permisos exclusivos de ADMIN.
- Bitácora `enrollments.runs` que rechaza UPDATE y DELETE.
- Eliminación de material, unidad y sesión con borrado real del archivo; 409 si la revisión es obsoleta o el curso ya fue publicado.
- Historial con antes/después y nombres; acceso al historial solo para personal autorizado.
- Triggers contra UPDATE de `courses.changes` y `courses.reviews`.
- Duración validada.
- Subida rechazada a un estudiante antes de leer el multipart.

Las de proxy verifican límites separados por cliente con proxy confiable, y que sin proxy confiable se ignora un `X-Forwarded-For` falsificado.

Capturas revisadas en `tmp/screens/`: `phase3-teacher`, `phase3-enrollments` y `phase3-student`.

Límites y efectos de esta verificación:
- Las pruebas de identidad enviaron correos de QA al Mailpit de desarrollo, que solo los captura.
- Las ejecuciones E2E y smoke dejan eventos de seguridad y bitácoras de matrícula de solo inserción en la base de desarrollo. Las cuentas, cursos, archivos e inscripciones de QA se eliminaron.
- No se ejecutaron CI remoto, carga, failover, TLS de producción ni el adaptador real del Registro Académico.
- No se implementaron evaluaciones.

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
