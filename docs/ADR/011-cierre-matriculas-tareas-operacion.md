# ADR-011: matrículas nocturnas, tareas y plagio, monitoreo y operación (cierre del proyecto)

Estado: aceptado el 11 de noviembre de 2026 (rama `feat/cierre-proyecto`). Implementa CAR-09, CAR-05, CAR-10 y CAR-14; CU-04, CU-12, CU-14 y CU-15; EAC-02 y EAC-06 en entorno local. Mantiene el monolito modular con **un único backend desplegable** (ADR-001): todos los trabajos en segundo plano corren dentro de la API, seguros con varias réplicas.

**Autorización del usuario (regla 1 de AGENTS.md):** al ser un proyecto universitario sin acceso al Registro Académico institucional, a un proveedor de plagio ni a una nube, esos servicios se **SIMULAN** con servicios propios que funcionan de punta a punta y están marcados como «SIMULADO» en el código, la interfaz y la documentación. La «nube» es Docker Compose local. Esta diferencia con el informe queda registrada aquí y en [ENTREGA.md](../ENTREGA.md).

## Parte A — Matrículas nocturnas (CAR-09, EAC-06, CU-12)

1. **Registro Académico SIMULADO** (`infra/registry`, servicio `registry` de Compose): REST mínimo de solo lectura, fuera del LMS, sin dependencias npm. Estudiantes ficticios por sección (código + período) sembrados desde `sections.json`, clave `X-Registry-Key`, y controles de simulación (`PUT /admin/mode` con `up | down | slow`, `failNext` y `PUT /admin/sections/...`).
2. **Puerto `AcademicRegistry`** en `enrollments` con el adaptador `HttpAcademicRegistry` (timeout de 5 s; 5xx, timeout o red ⇒ `RegistryUnavailableError`; 404 ⇒ sección inexistente).
3. **Vínculo curso ↔ sección:** `enrollments.sections`, alimentado por `courses` mediante el contrato público `REGISTRY_SECTIONS` al crear o editar un curso (y por un *backfill* de la migración). Así `enrollments` no depende de `courses`, que ya depende de él (sin ciclos).
4. **Sincronización** (`RegistrySyncService`): para cada sección vinculada consulta el registro y aplica la **conciliación existente** (`reconcile`, altas, reactivaciones y bajas en una transacción con lock por curso) con `source = 'REGISTRY_SYNC'` y el actor de sistema. Los correos sin cuenta activa de estudiante se cuentan como «sin cuenta» y no se crean (identity es la dueña de las cuentas).
5. **Reintentos:** «hasta 3 reintentos» se interpreta como 1 llamada inicial + 3 reintentos por sección, con backoff exponencial (base configurable, 2 s en Compose: 2, 4 y 8 s). Si se agotan, la ejecución termina `FAILED` con el motivo y sin tocar la proyección; el LMS sigue operando con la última lista.
6. **Planificador dentro del backend:** cada minuto comprueba si ya son ≥ 02:00 en America/Lima; la ranura `NIGHTLY:<fecha local>` es **única** en `enrollments.sync_runs`, y las reclamaciones se serializan con un *advisory lock*, de modo que con varias réplicas la ejecución nocturna ocurre una sola vez por día. Nunca hay dos ejecuciones simultáneas (`409 SYNC_IN_PROGRESS`); una ejecución `RUNNING` de más de 30 min (réplica caída) se cierra como `ABANDONED`. Las ejecuciones terminadas son inmutables (trigger).
7. **Alertas:** el nuevo módulo `administration` convierte cada ejecución fallida reciente en una notificación `SYSTEM_ALERT` para cada ADMIN activo a través del contrato `NOTIFICATION_SENDER`, con clave de deduplicación (una vez por fallo y administrador). Se ubica en `administration` porque `collaboration` depende de `enrollments` (evita el ciclo).
8. **UI ADMIN «Registro académico»:** estado del registro (insignia SIMULADO, latencia, modo), «Sincronizar ahora» e historial de ejecuciones.

## Parte B — Tareas y plagio (CAR-05, CAR-10, CU-04, CU-15)

1. **«Tarea» = evaluación `RUBRIC` de `assessments`** con entrega de archivo; se reutilizan el ciclo de vida, la rúbrica y `grading`. No se añadió un tipo nuevo para no duplicar reglas de publicación, pesos y Strategy.
2. **Módulo `submissions`** (esquema propio): el estudiante inscrito en un curso PUBLICADO entrega PDF, DOCX o TXT (≤ 10 MB, validación por extensión, MIME y contenido con el patrón de almacenamiento de `courses`) mientras la evaluación está PUBLICADA y **antes del vencimiento decidido con el reloj de PostgreSQL**. Puede reemplazarla hasta entonces: cada versión es una fila inmutable de `submissions.files` (trigger), y la entrega solo avanza de versión.
3. **Outbox:** la versión y el evento `SubmissionReceived.v1` se escriben en la **misma transacción** (`submissions.outbox`), como en `exams`. Al recibir, se extrae el texto (TXT, DOCX y PDF en modo *best effort*) para el control de similitud; un acuse `SUBMISSION` llega a la bandeja del estudiante (*best effort*).
4. **Módulo `plagiarism`:** puerto `PlagiarismProvider` y proveedor **SIMULADO** `SIMULADO-NGRAM-v1`, que compara la entrega con la versión vigente de las entregas de los demás estudiantes del curso mediante 3-gramas de palabras normalizadas (containment) y devuelve el porcentaje máximo y las fuentes. No es un motor de plagio de producción (exclusión del informe); el adaptador real del proveedor institucional se conecta al mismo puerto.
5. **Consumidor asíncrono** dentro del backend: toma eventos con `FOR UPDATE SKIP LOCKED` (una réplica por evento), reintenta con backoff (hasta 10 intentos) y es **idempotente por archivo** (`plagiarism.reports.fileId` único). Un archivo sin texto extraíble produce un informe `UNSUPPORTED`.
6. **UI (pestaña Evaluaciones):** el estudiante ve su entrega, versiones, estado y nota, y puede reemplazar el archivo hasta el plazo. El docente responsable ve todos los inscritos, descarga, ve el informe de similitud y califica con la rúbrica (`grading`, auditado); los cambios posteriores de nota siguen en Calificaciones con motivo. El ADMIN solo lee.

## Parte C — Monitoreo y operación (CAR-14, CU-14, EAC-02)

1. **Métricas:** un middleware de `administration` mide cada petición por **plantilla de ruta** (nunca IDs ni query) con un histograma fijo fusionable; cada réplica acumula en memoria y vuelca cada 10 s en `administration.request_metrics` (con retención de 24 h), y registra su latido en `administration.instances`.
2. **Panel ADMIN «Monitoreo»** (fusiona todas las réplicas): p50/p95 por ruta, tasa de errores 5xx, colas de outbox de `exams` y `submissions` (pendientes, con reintentos y antigüedad), intentos activos, estado de los trabajos (calificación, plagio, sincronización nocturna y anclaje) y última sincronización. Contratos nuevos: `EXAM_MONITOR`, `SubmissionEvents.backlog` y `AUDIT_ANCHOR_STATUS`.
3. **Umbrales y alertas:** p95 > 1000 ms (objetivo EAC-01), errores > 5 % y colas con antigüedad > 120 s (configurables), con un mínimo de 20 peticiones. Generan alertas en la bandeja, una por ventana de 5 min.
4. **Operación local** (`compose.yaml`):
   - Dos réplicas (`api`, `api2`) detrás de Nginx con failover pasivo (`max_fails`, `proxy_next_upstream`) y re-resolución DNS.
   - HTTPS con un certificado **local autofirmado** generado al primer arranque, TLS 1.2/1.3, HSTS y redirección 301 desde HTTP.
   - Un servicio `migrate` aplica las migraciones con el propietario y aprovisiona **`edutrack_app`**: sin propiedad de objetos, sin DDL, solo SELECT/INSERT en `audit` (ni UPDATE, ni DELETE, ni TRUNCATE) y sin acceso al historial de migraciones; el script lo autoverifica. Las réplicas se conectan con ese rol.
   - **Anclaje de auditoría:** cada 5 min (Compose) el último `id`/`hash` de la cadena se añade a un JSONL en el volumen separado `audit_anchors`; `GET /api/audit/anchors/verify` detecta una reescritura completa de la cadena.
   - `scripts/db-backup.mjs`: `backup` (pg_dump con SHA-256), `verify` (restauración en una BD temporal, comparación de conteos y verificación de la cadena de auditoría) y `restore --yes`.
   - `max_connections=300`: cada réplica puede abrir hasta ~100 conexiones (un pool por módulo); con 100 se agotaban las conexiones durante la carga con 2 réplicas.
5. **Prueba de carga con caída de réplica:** `compose.loadtest.yaml` apunta las réplicas a la BD desechable `edutrack_test` y usa una configuración de Nginx que conserva `X-Forwarded-For` (solo carga). El script mata `api2` al 50 % de los guardados y la vuelve a arrancar.

## Consecuencias y límites

- **Simulado ≠ certificado:** el registro y el proveedor de plagio son simulados, el TLS es autofirmado y las 2 réplicas comparten una máquina y un PostgreSQL sin réplica. La carga es local, no de 3000 estudiantes, y no certifica EAC-01 ni el 99,5 % de EAC-02.
- El limitador de peticiones es en memoria **por réplica**: con 2 réplicas el límite efectivo de login es hasta 2 × 5/min por IP. Para producción se necesita un almacén compartido (pendiente desde ADR-007).
- Las entregas y los informes no se borran (son evidencia); las pruebas E2E dejan entregas de QA en la base de desarrollo.
- Notificaciones solo dentro de la aplicación (sin correo ni push), como en ADR-010.
- Dependencias nuevas, sin ciclos (prueba AST):
  - `enrollments` → audit;
  - `submissions` → identity, courses, enrollments, assessments, grading, collaboration;
  - `plagiarism` → identity, courses, assessments, submissions;
  - `administration` → identity, enrollments, collaboration, exams, submissions, audit.
