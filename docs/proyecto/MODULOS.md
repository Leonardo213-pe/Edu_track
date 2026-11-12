# Límites del monolito modular

`modules.json` es el catálogo verificable de propiedad y dependencias síncronas previstas. Toda dependencia atraviesa un puerto local y un contrato `public`. Los eventos permiten proyecciones sin consultas privadas. Un rol global nunca sustituye la autorización por curso/sección.

| Módulo | Datos y responsabilidades propios | Contrato / eventos previstos | Estado |
| --- | --- | --- | --- |
| identity | Usuarios, credenciales, rol, sesiones, recuperación y eventos de seguridad | `IDENTITY_DIRECTORY`, `IdentityDirectory`, `Principal`, `UserProfile`, `Permission` | Fase 2 implementada: administración, acceso/salida revocable, perfil, contraseñas, estado y roles |
| courses | Curso/sílabo, unidades/sesiones con duración, materiales/versiones, revisión, historial de cambios y completitud | CourseCatalog, puertos de identidad/matrícula/almacenamiento | CAR-01/02/03 implementados, State/Composite; ADR-006 |
| assessments | Bancos y preguntas, evaluaciones, ciclo de vida y snapshot publicado | ASSESSMENT_CATALOG: `gradable`, `findGradable` (sin respuestas) | Implementado fase 4 (ADR-008) |
| exams | Intentos, preguntas sorteadas, respuestas versionadas, vencimiento y outbox | `AttemptFinalized.v1` (outbox); consume ASSESSMENT_CATALOG y GRADE_RECORDER | Implementado fase 5 (ADR-009) |
| submissions | Entregas de tareas con rúbrica, versiones inmutables y texto extraído | SubmissionReceived.v1 (outbox), SUBMISSION_EVENTS | Implementado (ADR-011) |
| grading | Notas LMS (Strategy), versiones con motivo, promedios ponderados | `GRADING_SCALE` | Implementado fase 4 |
| collaboration | Foros, hilos, mensajes, suscripciones, bandeja y recordatorios | `NOTIFICATION_SENDER` | Implementado fase 8 (ADR-010) |
| analytics | Tiempo de conexión y reglas de riesgo por curso | HTTP para personal | Implementado fase 8 (ADR-010) |
| enrollments | Proyección persistida de la lista oficial de inscritos por curso y bitácora de conciliaciones | ENROLLMENT_ACCESS: `EnrollmentAccess.isEnrolled/coursesOf`; REGISTRY_SECTIONS, REGISTRY_SYNC_STATUS; HTTP ADMIN de conciliación y sincronización | Implementado: proyección (ADR-007) y sincronización nocturna con el registro SIMULADO (ADR-011) |
| plagiarism | Informes de similitud del proveedor (puerto PlagiarismProvider; adaptador SIMULADO) | Consume SubmissionReceived.v1 | Implementado con proveedor SIMULADO (ADR-011) |
| audit | Entradas de solo inserción con hash encadenado y verificación | Contrato BD `audit.append_entry`/`audit.record_row_change`, `AUDIT_ACTOR_SETTING` | Implementado fase 4 |
| administration | Métricas por réplica, panel de monitoreo y alertas operativas | Consume EXAM_MONITOR, SUBMISSION_EVENTS, REGISTRY_SYNC_STATUS, AUDIT_ANCHOR_STATUS; usa NOTIFICATION_SENDER | Implementado (ADR-011) |

Los módulos reservados `materials` y `course-review` (carpetas vacías desde ADR-006) se retiraron al cerrar el proyecto: su capacidad vive en `courses`. ADR-006 sustituye la división persistente inicialmente propuesta: transición, evidencia y versiones pertenecen al agregado courses. Los espacios reservados no acceden a esas tablas. Archivos ya se guardan fuera de PostgreSQL con límites y descarga autorizada. S3/antivirus/conciliación operacional pendientes.

Notas y auditoría necesitan una transacción compartida sin exponer entidades/repositorios. Se diseñará un puerto de transacción y un contrato público de escritura de auditoría que use el contexto transaccional opaco; las implementaciones permanecen en adaptadores. No usar un evento en memoria para garantizar auditoría.

Matrícula no ofrece alta manual oficial. Solo concilia la proyección del legado. Plagio encapsula API externa y nunca implementa su propio motor. Foros/notificaciones se agrupan en un contexto de colaboración con dos áreas internas; pueden subdividirse sin crear procesos desplegables.
