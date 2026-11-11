# Arquitectura

## Estructura ejecutable

Un repositorio npm workspaces, **un backend desplegable**, una SPA estática y PostgreSQL. Cada contexto de negocio contiene su hexágono. Identidad y Cursos están implementados; los demás mantienen alcance planificado. ADR-006 consolida materiales/revisión en el agregado académico, sin módulos ficticios ni transacciones cruzadas. La unidad de despliegue no cambia.

```text
apps/api/src/
  bootstrap.ts                         # composición de la aplicación y salud
  modules/<business-module>/
    public/index.ts                    # tipos, consultas y eventos públicos puros
    domain/                            # entidades, invariantes, errores
    application/                       # casos de uso y puertos
    infrastructure/http/               # DTO, controllers, guards, filtros
    infrastructure/persistence/        # mapeos, Prisma generado y repositorio
    infrastructure/security/           # hashing/JWT
    infrastructure/cli/                # adaptador de aprovisionamiento
    <module>.module.ts                 # composición Nest del módulo implementado
apps/web/src/                          # SPA React, no autoridad de permisos
apps/api/prisma/                       # esquema y migraciones versionadas
tests/architecture.test.mjs            # verificación AST de dependencias
infra/                                # imágenes y proxy
```

## Dependencias permitidas

| Origen | Puede depender de |
| --- | --- |
| `public` | Contratos públicos del propio módulo, tipos TypeScript |
| `domain` | Dominio propio y contratos públicos propios |
| `application` | Dominio, aplicación y contratos propios; nunca infraestructura |
| `infrastructure` | Puertos/casos de uso, dominio propio, frameworks y SDK necesarios |
| Composición `*.module.ts` | Construcción explícita de casos de uso y adaptadores propios |
| Otro módulo | Exclusivamente `modules/<id>/public/index.ts`, según `modules.json` |
| Raíz `bootstrap.ts` | Entradas de composición, plumbing HTTP y salud |

Las consultas hacia otro módulo se implementan mediante puertos propios y un adaptador que consume el contrato público. El dominio nunca referencia entidades ajenas. Los módulos no consultan tablas ajenas; los IDs son referencias opacas. No se crean aliases de importación que eludan el control de arquitectura. El control AST examina imports, reexports, imports de tipos, require e import dinámico estático; prohíbe importaciones dinámicas no verificables. Su alcance es dependencias de código: no inspecciona semánticamente cada consulta SQL; revisar también propiedad de datos.

El esquema Prisma central es un artefacto de migración, no una capa de repositorios global. Contiene `identity` y `courses`, con clientes generados dentro de cada adaptador. Cada repositorio usa sus propias tablas; referencias a usuarios/matrículas por ID y contrato, sin consultas/FKs a tablas ajenas. Cuentas de privilegios mínimos son objetivo de producción; Compose usa una cuenta de desarrollo.

## Identidad implementada

`User` mantiene email normalizado, nombre, rol, estado y versión; produce perfiles seguros con permisos públicos. `IdentityService` implementa alta/edición/listado por ADMIN, perfil propio, acceso/salida, contraseñas y registro de seguridad. Puertos: `UserRepository`/`IdentityData` transaccional, `PasswordHasher`, `AccessTokens`, `SecurityTokens`, `ResetMailer`, `Runtime`. Nest compone los adaptadores sin decoradores en el núcleo. El token exportado `IDENTITY_DIRECTORY` ofrece el contrato público puro `IdentityDirectory` a los futuros módulos.

Prisma traduce filas a `User` y P2002 a conflicto de email. Mutaciones de identidad con advisory lock transaccional propio del módulo protegen al último ADMIN y releen actor/sesión al escribir. Edición optimista por versión. Hashing fuera del lock. Cuenta/sesión/recuperación/evento atómicos, sin exponer tipos Prisma al núcleo. No extender este lock a exámenes. Atomicidad académica nota/auditoría sigue pendiente.

JWT HS256 con issuer/audience/algoritmo fijos, expiración 900 s, `sub` y `jti` enlazados a sesión PostgreSQL revocable. Comprobar sesión/propietario/estado cada petición; rol siempre de BD. Scrypt con sal aleatoria, N=131072, r=8, p=1 y comparación constante; hash ficticio para email desconocido. Contraseñas 12-128 caracteres. Token en memoria SPA, sin refresh. Logout revoca sesión; cambios de acceso/contraseña revocan todas las afectadas. Rate limiting HTTP sigue en memoria por instancia.

Recuperación con secreto opaco 256 bits, SHA-256, vencimiento 15 min, un uso y revocación atómica. No devolver token en API/logs. Outbox de recuperación con payload AES-GCM cifrado y consumidor SMTP dentro del mismo backend. Mailpit captura correos reales en desarrollo, no entrega a Internet. Eventos de identidad append-only en su propio esquema; no equivalen a auditoría académica CAR-12. Ver [ADR-005](ADR/005-identidad-completa.md) para garantías y límites.

## Cursos implementado (fase 3)

`courses` posee curso/sílabo/unidades/sesiones/materiales/versiones/revisiones y completitud básica. Dominio puro con State y Composite; aplicación con cinco puertos, PostgreSQL/local y contratos públicos de identidad/matrícula. Revisión optimista y lock por curso hacen atómicos estado/estructura/decisión. PUBLICADO es ineditable: volver a BORRADOR retira publicación hasta nueva aprobación. ARCHIVADO terminal. Estudiantes solo publicado+matrícula, incluidas descargas.

Archivos reales en volumen privado, claves UUID, firma/MIME/tamaño, SHA-256, versiones sin UPDATE y descargas autenticadas. Enlaces HTTP(S). S3 futuro por puerto; no integración ficticia. Progreso por versión vigente completada, no heredado al versionar. Reporte de actividad no equivale a padrón total ni riesgo académico. Matrícula consultada al contrato `EnrollmentAccess` (proyección persistida, sin fixtures). Agregado encapsulado (`DeepReadonly`, `snapshot`), State con editabilidad/visibilidad, Composite con duración, historial `courses.changes` de solo inserción y eliminación solo en borradores nunca publicados (ADR-007). Ver [ADR-006](ADR/006-cursos-contenidos.md), [Cursos](CURSOS.md), [OpenAPI](openapi.json), [diagramas](diagrams/CURSOS.md).

## Matrículas implementado (proyección)

`enrollments` posee la proyección local de la lista oficial de inscritos (`enrollments.enrollments`) y la bitácora de conciliaciones `enrollments.runs` (solo inserción). Depende solo de `identity/public`; los cursos son referencias opacas, sin ciclo con `courses`. La conciliación es atómica e idempotente con lock por curso. La lista la entrega un ADMIN hasta el adaptador CAR-09. Ver [ADR-007](ADR/007-proyeccion-matriculas-cierre-fase3.md).

## Seguridad de borde

`TRUST_PROXY` define los proxies confiables de Express. Nginx sobrescribe `X-Forwarded-For` con la IP real, de modo que el limitador funciona por cliente y no admite suplantación. La prueba AST también verifica la raíz de composición, las dependencias reales frente a `modules.json` y que cada adaptador Prisma use solo las tablas y el SQL de su propio esquema.

## Evaluaciones, calificación y auditoría implementadas (fase 4)

`assessments` posee bancos, preguntas, evaluaciones (State BORRADOR/PUBLICADA/CERRADA) y el snapshot inmutable de preguntas al publicar; las respuestas correctas nunca salen hacia estudiantes. `grading` aplica Strategy (automática y rúbrica), notas versionadas con motivo y promedios ponderados en centésimas enteras. `audit` posee `audit.entries` con hash SHA-256 encadenado; su contrato de escritura es la función `audit.append_entry`, invocada por triggers en `grading.grades` y `assessments.assessments`, de modo que cada cambio auditable y su entrada se confirman en la misma transacción (el actor se declara con `set_config('edutrack.actor', …, true)`). Un guard Bearer genérico en `src/platform/http` autentica mediante el contrato público de identidad. Ver [ADR-008](ADR/008-evaluaciones-calificacion-auditoria.md) y [EVALUACIONES.md](EVALUACIONES.md).

## Exámenes implementados (fase 5)

`exams` posee intentos (vencimiento fijado por el servidor, preguntas sorteadas sin respuestas), respuestas por intento/pregunta con versión monotónica y un outbox transaccional. El guardado se acepta solo con el intento abierto según el reloj de PostgreSQL y una versión mayor; el ACK sale tras el commit. La finalización (o el barredor de vencidos, `SKIP LOCKED`) escribe `AttemptFinalized.v1` en la misma transacción; un consumidor dentro del mismo backend califica con `GradeRecorder` (Strategy automática, idempotente por intento, auditado como Sistema). Ver [ADR-009](ADR/009-examenes-concurrentes.md) y [EXAMENES.md](EXAMENES.md).

## Comunicación futura y consistencia

Los contratos son DTO inmutables y versionados; eventos incluyen `eventId`, `occurredAt`, `schemaVersion`, `aggregateId` y `correlationId`. Consumidores idempotentes con inbox. Para efectos durables usar outbox transaccional en PostgreSQL y consumidor alojado en el **mismo ejecutable backend**. Una sola réplica debe reclamar cada trabajo mediante lease/claim atómico (`SKIP LOCKED` para trabajos, no bloqueo prolongado de intentos). No hay broker ni EventBus ficticio en el incremento inicial. Una llamada interna no durable solo sirve para efectos que se pueden perder.

Eventos previstos: `CoursePublished.v1`, `AttemptFinalized.v1`, `SubmissionReceived.v1`, `GradeChanged.v1`, `EnrollmentsSynchronized.v1`, `ForumMessagePosted.v1`. No transportar respuestas correctas ni credenciales en eventos de lectura pública. `analytics` y `administration` consumirán proyecciones/eventos, sin acceso a repositorios ajenos.

## Exámenes y auditoría: diseño pendiente

Servidor como fuente de tiempo, snapshot de preguntas/opciones sorteadas, validación de matrícula/ventana/propietario, unicidad intento/pregunta, versión monotónica y finalización idempotente. Cliente conserva pendientes y reintenta sin duplicar. Persistir confirmaciones durables antes de responder; el ADR-004 analiza el buffer Redis del informe. No hay endpoint de exámenes todavía.

Auditoría futura de solo inserción, cambio y auditoría en una transacción, hash encadenado con orden serializado definido por cadena y verificación periódica/anclaje separado. Privilegios y triggers rechazan alteración de registros. No publicar notas ni edición de exámenes sin esa garantía. No basta un log de aplicación.

## Operación y verificación

Compose: PostgreSQL persistente, API con migraciones y readiness, Nginx sin privilegios sirviendo SPA y proxy. API corre como usuario `node`; secretos runtime. HTTP limitado a loopback, TLS terminado externamente para producción. Imagen única de backend; no Worker separado. La imagen local conserva CLI de migración y dependencias de build; endurecimiento/separación de credenciales de migración pendiente antes de producción.

Unitarias y cobertura del núcleo, pruebas frontend con fetch identificado como doble, integración HTTP con Nest compilado + Prisma + PostgreSQL real, y reglas AST. CI usa PostgreSQL real desechable. Carga/failover están definidos, no ejecutados ni garantizados. [C4](diagrams/C4.md) y [4+1](diagrams/MODELO_4_MAS_1.md) separan estado actual y diseño previsto.
