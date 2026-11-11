# ADR-006: contexto académico cohesivo para CAR-01/02/03

Estado: adoptado en la etapa 3. Contexto: el repositorio tenía espacios planificados separados para cursos, materiales y revisión, sin implementaciones. La solicitud actual agrupa Gestión de Cursos y Contenidos y exige que estado, contenido, versiones y decisiones sean coherentes.

## Límites y patrones

Se implementa el contexto `courses` con dominio, aplicación, infraestructura y contratos públicos propios. Posee curso, sílabo como valor de texto del curso, unidades, sesiones, materiales/versiones, decisiones de revisión y completitud básica. Los espacios `materials` y `course-review` quedan reservados para una eventual extracción interna, sin implementar tablas, repositorios o fachadas duplicadas. Esta decisión sustituye sus límites inicialmente propuestos en MODULOS; no se presentan tres módulos vacíos como implementados. `analytics` seguirá siendo responsable de conexión y reglas/proyecciones de riesgo, no del registro básico de completitud.

La alternativa de tres módulos persistentes independientes requería coordinar publicación, bloqueo de edición y evidencia de revisión entre tres transacciones. Un agregado académico cohesivo conserva el estado y sus decisiones en una transacción PostgreSQL, con menor acoplamiento entre contextos. No hay backend nuevo ni microservicios. Si en el futuro se extraen materiales/revisión, hacerlo mediante contratos y una decisión explícita sobre consistencia; no leer tablas privadas.

`CourseService` depende de puertos `CourseRepository`, `CourseIdentity`, `CourseEnrollment`, `CourseStorage` y `CourseRuntime`. Prisma permanece en persistencia; ID de docente/estudiante es una referencia opaca, sin FK ni consultas a tablas de identidad. `IdentityDirectory` se amplía solo para exponer autenticación ya existente y un directorio mínimo de docentes activos (id/nombre). No se reimplementan JWT o sesiones. `CourseCatalog` exporta metadatos publicados para consumidores futuros.

State: objetos concretos Draft/InReview/Published/Archived deciden transiciones. Composite: AcademicGroup y MaterialLeaf implementan la misma operación de conteo; curso/unidades/sesiones agrupan hojas de material vigente. Repository/DI: persistencia y almacenamiento se inyectan en composición, no en dominio.

## Flujo y permisos

- BORRADOR → EN_REVISION: docente responsable o ADMIN; sílabo no vacío, una sesión por unidad y material en cada sesión. Requisito de completitud explícito del incremento.
- EN_REVISION → PUBLICADO: solo Diseñador Instruccional; no se admite autoaprobación si su ID coincide con responsable. ADMIN no sustituye esa aprobación.
- EN_REVISION → BORRADOR: rechazo del diseñador con observaciones obligatorias.
- PUBLICADO → BORRADOR: responsable/ADMIN inicia nueva revisión. Se retira inmediatamente el acceso estudiantil hasta nueva aprobación; no se mantiene una publicación anterior en paralelo.
- BORRADOR o PUBLICADO → ARCHIVADO: responsable/ADMIN. ARCHIVADO es terminal y rechaza modificaciones ordinarias. EN_REVISION debe resolverse por diseñador, sin archivado directo.

Solo BORRADOR admite edición de metadatos, sílabo, orden y nuevas versiones. Profesor solo cursos propios; ADMIN administra y asigna únicamente docentes activos. Diseñador consulta contenido para revisión. Estudiante requiere estado PUBLICADO y matrícula afirmativa del puerto, también en descargas. No se toma identidad/rol del body. Historial completo de versiones y revisión solo para personal autorizado; estudiante recibe versión vigente y no recibe observaciones internas.

## Integridad y almacenamiento

Esquema `courses`, clave única código normalizado/período, posiciones únicas por padre, FKs internas y restricciones de payload. Revisión optimista en cada mutación y advisory lock por curso, no global: modificaciones concurrentes con revisión vieja devuelven 409. Orden usa restricciones UNIQUE diferibles para intercambiar posiciones dentro de la transacción. Revisiones y cambios de estado atómicos. Las versiones se insertan, nunca se actualizan; trigger rechaza UPDATE. No hay API de borrado de historia. Eliminación privilegiada de fixtures/curso usa cascadas, no se presenta como auditoría académica inmutable CAR-12.

Almacenamiento local real detrás de `CourseStorage`, con claves UUID sin rutas del cliente, permisos locales, SHA-256 y metadatos. Volumen Docker `course_files`; no hay ruta estática pública. Descargas autenticadas y `nosniff`, adjuntos. Extensiones admitidas PDF/DOCX/PPTX/TXT/MP4/WebM, hasta 25 MiB; comprobación básica de firma/contenedor/UTF-8 y MIME. Enlaces solo HTTP/HTTPS sin credenciales. DOCX/PPTX requieren visor externo; PDF/TXT/video tienen visor en navegador cuando el navegador lo permite.

Se guarda archivo antes de transacción de metadatos y se elimina si esta falla. Una caída de proceso en esa ventana puede dejar un archivo huérfano: conciliación/retención posterior pendiente. Firma no equivale a antivirus. S3 es intercambiable mediante el puerto, pero no hay adaptador S3 ni conexión ficticia en esta fase. Escaneo antimalware, backups/restauración y streaming/rangos para videos grandes son endurecimiento operativo pendiente.

## Matrículas y progreso

Contrato público `EnrollmentAccess.isEnrolled` en `enrollments`; sin gestión de matrícula dentro de Cursos. Mientras CAR-09 no existe, el adaptador por defecto deniega. Fixtures JSON se habilitan solo con archivo y `ALLOW_TEST_ENROLLMENTS=true`; no simulan sincronización institucional, no están en Git y no se habilitan por defecto. API/UI siempre consumen cursos y archivos reales, incluso en esos ensayos.

Completitud idempotente por usuario/versión vigente. Avance = hojas vigentes completadas / hojas vigentes totales; vacío 0%. Versionar material obliga a completar la nueva versión. El reporte administrativo lista actividad observada, no matrícula total. Relojes/conexión/analítica de riesgo siguen pendientes.
