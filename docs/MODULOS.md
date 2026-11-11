# Límites del monolito modular

`modules.json` es el catálogo verificable de propiedad y dependencias síncronas previstas. Toda dependencia atraviesa un puerto local y un contrato `public`. Los eventos permiten proyecciones sin consultas privadas. Un rol global nunca sustituye la autorización por curso/sección.

| Módulo | Datos y responsabilidades propios | Contrato / eventos previstos | Estado |
| --- | --- | --- | --- |
| identity | Usuarios, credenciales, rol, sesiones, recuperación y eventos de seguridad | `IDENTITY_DIRECTORY`, `IdentityDirectory`, `Principal`, `UserProfile`, `Permission` | Fase 2 implementada: administración, acceso/salida revocable, perfil, contraseñas, estado y roles |
| courses | Curso/sílabo, unidades/sesiones, materiales/versiones, revisión y completitud básica | CourseCatalog, puertos de identidad/matrícula/almacenamiento | CAR-01/02/03 implementados, State/Composite; ADR-006 |
| materials | Espacio para eventual extracción de capacidad hoy en courses | Sin servicio ni tabla duplicados | Capacidad en courses; no módulo ejecutable separado |
| course-review | Espacio para eventual extracción de revisión hoy en courses | Sin fachada ficticia | Capacidad en courses; decisión/estado atómicos |
| assessments | Banco de preguntas, evaluaciones y snapshots publicados | PublishedAssessment; respuesta al estudiante sin soluciones | Planificado |
| exams | Intentos, vencimiento, preguntas asignadas, respuestas versionadas | AttemptSummary, AttemptFinalized | Planificado |
| submissions | Tareas, entregas y metadatos de archivos | SubmissionReference, SubmissionReceived | Planificado |
| grading | Estrategias, rúbricas, notas y promedios LMS | GradeSummary, GradeChanged | Planificado |
| collaboration | Foros, hilos, suscripciones, bandeja de notificaciones | ForumMessagePosted, NotificationRequested | Planificado |
| analytics | Proyecciones de progreso, conexión y riesgo; completitud fuente en courses | AcademicRisk, ProgressSummary | Planificado |
| enrollments | Proyección de inscritos, checkpoints e historial de sync | EnrollmentAccess.isEnrolled | Contrato/denegación por defecto/fixtures explícitos; sincronización real pendiente |
| plagiarism | Solicitudes y reportes del proveedor | PlagiarismReportAvailable | Planificado |
| audit | Registros de solo inserción, cadena y verificación | AuditAppendPort, AuditQuery | Planificado |
| administration | Política operativa, monitoreo y vistas de salud | OperationalStatus | Planificado; salud básica en raíz técnica |

ADR-006 sustituye la división persistente inicialmente propuesta: transición, evidencia y versiones pertenecen al agregado courses. Los espacios reservados no acceden a esas tablas. Archivos ya se guardan fuera de PostgreSQL con límites y descarga autorizada. S3/antivirus/conciliación operacional pendientes.

Notas y auditoría necesitan una transacción compartida sin exponer entidades/repositorios. Se diseñará un puerto de transacción y un contrato público de escritura de auditoría que use el contexto transaccional opaco; las implementaciones permanecen en adaptadores. No usar un evento en memoria para garantizar auditoría.

Matrícula no ofrece alta manual oficial. Solo concilia la proyección del legado. Plagio encapsula API externa y nunca implementa su propio motor. Foros/notificaciones se agrupan en un contexto de colaboración con dos áreas internas; pueden subdividirse sin crear procesos desplegables.
