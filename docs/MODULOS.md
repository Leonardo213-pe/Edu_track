# Límites del monolito modular

`modules.json` es el catálogo verificable de propiedad y dependencias síncronas previstas. Toda dependencia atraviesa un puerto local y un contrato `public`. Los eventos permiten proyecciones sin consultas privadas. Un rol global nunca sustituye la autorización por curso/sección.

| Módulo | Datos y responsabilidades propios | Contrato / eventos previstos | Estado |
| --- | --- | --- | --- |
| identity | Usuarios, credenciales y rol | `IdentityDirectory`, `Principal`, `UserProfile` | Alta, acceso y consulta operativos; administración completa parcial |
| courses | Sílabo, módulos, sesiones, ciclo del curso | CourseCatalog, CoursePublished | Planificado |
| materials | Material, versiones y referencias a objetos | MaterialVersions, MaterialVersionPublished | Planificado |
| course-review | Solicitud y decisión de revisión de una versión | ReviewDecision; invoca transición pública de courses | Planificado |
| assessments | Banco de preguntas, evaluaciones y snapshots publicados | PublishedAssessment; respuesta al estudiante sin soluciones | Planificado |
| exams | Intentos, vencimiento, preguntas asignadas, respuestas versionadas | AttemptSummary, AttemptFinalized | Planificado |
| submissions | Tareas, entregas y metadatos de archivos | SubmissionReference, SubmissionReceived | Planificado |
| grading | Estrategias, rúbricas, notas y promedios LMS | GradeSummary, GradeChanged | Planificado |
| collaboration | Foros, hilos, suscripciones, bandeja de notificaciones | ForumMessagePosted, NotificationRequested | Planificado |
| analytics | Progreso, conexión y reglas/proyecciones de riesgo | AcademicRisk, ProgressSummary | Planificado |
| enrollments | Proyección de inscritos, checkpoints e historial de sync | EnrollmentAccess, EnrollmentsSynchronized | Planificado |
| plagiarism | Solicitudes y reportes del proveedor | PlagiarismReportAvailable | Planificado |
| audit | Registros de solo inserción, cadena y verificación | AuditAppendPort, AuditQuery | Planificado |
| administration | Política operativa, monitoreo y vistas de salud | OperationalStatus | Planificado; salud básica en raíz técnica |

La transición de publicación pertenece a `courses`; `course-review` mantiene evidencia e invoca el puerto público de transición con autorización. Esto evita dos módulos escribiendo el mismo estado. Materiales almacenan objetos fuera de PostgreSQL en el futuro; archivos con límites, antivirus/políticas y URLs autorizadas aún pendientes.

Notas y auditoría necesitan una transacción compartida sin exponer entidades/repositorios. Se diseñará un puerto de transacción y un contrato público de escritura de auditoría que use el contexto transaccional opaco; las implementaciones permanecen en adaptadores. No usar un evento en memoria para garantizar auditoría.

Matrícula no ofrece alta manual oficial. Solo concilia la proyección del legado. Plagio encapsula API externa y nunca implementa su propio motor. Foros/notificaciones se agrupan en un contexto de colaboración con dos áreas internas; pueden subdividirse sin crear procesos desplegables.
