# Arquitectura

## Estructura ejecutable

Un repositorio npm workspaces, **un backend desplegable**, una SPA estática y PostgreSQL. Cada módulo de negocio contiene su propio hexágono. Identidad es el primer incremento; los demás son espacios explícitamente planificados. La unidad de despliegue no cambia al añadir módulos.

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

El esquema Prisma central es un artefacto de migración, no una capa de repositorios global. Actualmente solo contiene esquema `identity`. Al crecer, separar modelos por propiedad; cada adaptador usa exclusivamente tablas de su módulo. La base de datos es compartida físicamente, con esquemas lógicos y cuentas de permisos mínimos como objetivo de despliegue. Compose usa una cuenta de desarrollo y no satisface ese aislamiento operativo final.

## Identidad implementada

`User` mantiene email normalizado, nombre y rol válido; serializa un perfil seguro. `IdentityService` implementa acceso, autenticación del token contra usuario persistido, creación y listado exclusivo ADMIN. Sus puertos: `UserRepository`, `PasswordHasher`, `AccessTokens`, `Runtime`. Nest construye los adaptadores sin decoradores en el núcleo.

El repositorio traduce filas Prisma a `User` y convierte P2002 a conflicto de email. La unicidad se garantiza en PostgreSQL, incluido el caso de alta concurrente; una inserción atómica no requiere transacción explícita adicional. No se ha implementado un Unit of Work vacío. Las operaciones académicas futuras sí requerirán transacciones para nota/auditoría y finalización/outbox.

JWT HS256, issuer/audience/algoritmo fijo y expiración 900 s; sin rol confiado en el token. Scrypt con sal aleatoria por usuario, N=131072, r=8, p=1 y comparación constante. El caso de email desconocido verifica un hash ficticio generado al arrancar para reducir diferencias de tiempo. Contraseñas 12-128 caracteres. Tokens en memoria del frontend, perfiles sin credenciales. Rate limiting por IP en memoria. No hay refresh tokens ni revocación anticipada; ver límites en README.

## Comunicación futura y consistencia

Los contratos son DTO inmutables y versionados; eventos incluyen `eventId`, `occurredAt`, `schemaVersion`, `aggregateId` y `correlationId`. Consumidores idempotentes con inbox. Para efectos durables usar outbox transaccional en PostgreSQL y consumidor alojado en el **mismo ejecutable backend**. Una sola réplica debe reclamar cada trabajo mediante lease/claim atómico (`SKIP LOCKED` para trabajos, no bloqueo prolongado de intentos). No hay broker ni EventBus ficticio en el incremento inicial. Una llamada interna no durable solo sirve para efectos que se pueden perder.

Eventos previstos: `CoursePublished.v1`, `AttemptFinalized.v1`, `SubmissionReceived.v1`, `GradeChanged.v1`, `EnrollmentsSynchronized.v1`, `ForumMessagePosted.v1`. No transportar respuestas correctas ni credenciales en eventos de lectura pública. `analytics` y `administration` consumirán proyecciones/eventos, sin acceso a repositorios ajenos.

## Exámenes y auditoría: diseño pendiente

Servidor como fuente de tiempo, snapshot de preguntas/opciones sorteadas, validación de matrícula/ventana/propietario, unicidad intento/pregunta, versión monotónica y finalización idempotente. Cliente conserva pendientes y reintenta sin duplicar. Persistir confirmaciones durables antes de responder; el ADR-004 analiza el buffer Redis del informe. No hay endpoint de exámenes todavía.

Auditoría futura de solo inserción, cambio y auditoría en una transacción, hash encadenado con orden serializado definido por cadena y verificación periódica/anclaje separado. Privilegios y triggers rechazan alteración de registros. No publicar notas ni edición de exámenes sin esa garantía. No basta un log de aplicación.

## Operación y verificación

Compose: PostgreSQL persistente, API con migraciones y readiness, Nginx sin privilegios sirviendo SPA y proxy. API corre como usuario `node`; secretos runtime. HTTP limitado a loopback, TLS terminado externamente para producción. Imagen única de backend; no Worker separado. La imagen local conserva CLI de migración y dependencias de build; endurecimiento/separación de credenciales de migración pendiente antes de producción.

Unitarias y cobertura del núcleo, pruebas frontend con fetch identificado como doble, integración HTTP con Nest compilado + Prisma + PostgreSQL real, y reglas AST. CI usa PostgreSQL real desechable. Carga/failover están definidos, no ejecutados ni garantizados. [C4](diagrams/C4.md) y [4+1](diagrams/MODELO_4_MAS_1.md) separan estado actual y diseño previsto.
