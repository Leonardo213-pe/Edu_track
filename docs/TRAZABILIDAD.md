# Matriz de trazabilidad

Fuente: informe pp. 6-10, 12 y 35. «Pendiente» incluye directorios diseñados; no implica código operativo. Las pruebas de identidad no prueban las reglas académicas futuras.

| Requisito | Casos de uso | Módulos responsables | Verificación prevista / existente | Estado |
| --- | --- | --- | --- | --- |
| CAR-01: sílabo y estructura | CU-01,06 | courses | Composite (avance y duración), PostgreSQL, edición/orden/eliminación en borrador nunca publicado, propietario, revisión optimista, historial, navegador | Implementado fase 3 (ADR-006/007) |
| CAR-02: multimedia versionado | CU-02,06 | courses según ADR-006 | Archivos reales, bytes/hash, historial sin sobreescritura, enlaces HTTP(S), descargas autorizadas | Implementado con almacenamiento local; S3 futuro por puerto |
| CAR-03: aprobación | CU-10 | courses según ADR-006 | State (transiciones, editabilidad, visibilidad), rechazo con observaciones, aprobación solo diseñador, reapertura retira publicación, archivado, decisiones e historial inmutables ante UPDATE | Implementado fase 3 |
| CAR-04: banco/aleatoriedad/reloj | CU-03,07 | assessments, exams | Banco por tipo, snapshot inmutable al publicar, sorteo sin repetición, respuestas nunca al estudiante (ADR-008); vencimiento por intento | Implementado: banco, snapshot y sorteo (fase 4) y rendir contra reloj por intento con vencimiento del servidor (fase 5, ADR-009) |
| CAR-05: archivos | CU-04 | submissions | Estudiante inscrito, tarea publicada, PDF/DOCX/TXT ≤ 10 MB validados por contenido, plazo con reloj de BD, versiones inmutables, entrega + SubmissionReceived en la misma transacción (outbox), descarga autorizada, calificación con rúbrica | Implementado (ADR-011): unitarias, integración PostgreSQL y E2E |
| CAR-06: notas/rúbricas/promedios | CU-08 | grading | Strategy (automática todo-o-nada y rúbrica), escala 0–20, pesos ≤100 %, redondeo half-up, promedio final entero, aprobación 11, cambios con versión y motivo | Implementado: rúbrica (fase 4) y calificación automática de cada intento finalizado vía outbox (fase 5) |
| CAR-07: foros/notificaciones | CU-05,09 | collaboration | Foros por curso/unidad, Observer, suscripciones, moderación, recordatorios idempotentes, aviso de nota, bandeja | Implementado fase 8 (ADR-010); correo/push externos pendientes |
| CAR-08: progreso/riesgo | CU-01,11 | courses (completitud), analytics (proyecciones) | Composite/idempotencia/versión vigente y actividad observada | Implementado: completitud (fase 3), tiempo de conexión y riesgo por reglas configurables explicables (fase 8, ADR-010) |
| CAR-09: matrícula nocturna | CU-12 | enrollments, administration | Puerto AcademicRegistry + adaptador REST, planificador 02:00 America/Lima con ranura diaria única (varias réplicas), «Sincronizar ahora», 3 reintentos con backoff, conciliación REGISTRY_SYNC, ejecución FAILED + alerta ADMIN | Implementado contra el **Registro Académico SIMULADO** (ADR-011); el contrato institucional real sigue pendiente |
| CAR-10: plagio externo | CU-04,15 | plagiarism, submissions | Puerto PlagiarismProvider, consumidor asíncrono del outbox (SKIP LOCKED, reintentos, idempotente por archivo), informe de similitud solo para el personal | Implementado con proveedor **SIMULADO** por 3-gramas (ADR-011); el proveedor institucional se conecta al mismo puerto |
| CAR-11: concurrencia/durabilidad | CU-03 | exams | Fila por intento/pregunta, versión monotónica, ACK tras commit, reloj de BD, reconexión con cola local, reinicio de API probado, carga local | Implementado fase 5; certificación de carga/failover pendiente de entorno representativo |
| CAR-12: auditoría inmutable | CU-08,14 | audit, grading, assessments | Trigger atómico en notas y evaluaciones publicadas, hash SHA-256 encadenado, UPDATE/DELETE/TRUNCATE rechazados, verificación de cadena, consulta ADMIN | Implementado fase 4 (ADR-008); rol de aplicación sin propiedad ni UPDATE/DELETE en auditoría y anclaje periódico del último hash en un volumen separado (ADR-011, smoke e integración) |
| CAR-13: usuarios/roles | CU-13 | identity | Unitarias, HTTP/Prisma/PostgreSQL/SMTP, frontend y navegador | Fase 2 implementada: alta administrativa, edición/listado, cuatro roles, activación/baja lógica, perfil, contraseñas, sesiones revocables y registro de seguridad |
| CAR-14: monitoreo | CU-11,14 | administration, analytics | Métricas por réplica y ruta (p50/p95, errores), colas outbox, intentos activos, trabajos, última sincronización, umbrales con alertas en la bandeja | Implementado (ADR-011); sin monitor externo ni APM gestionado |

| Escenario | Objetivo del informe | Estado y evidencia |
| --- | --- | --- |
| EAC-01 | 3.000 concurrentes, p95 ≤1 s, cero pérdida confirmada | Medición local 200×10 simultáneos: p95 724 ms, 0 ACK perdidos (PRUEBAS_CARGA); 3.000 en entorno representativo pendiente |
| EAC-02 | Recuperación ≤5 min, disponibilidad 99,5% | Compose local con 2 réplicas tras Nginx: `api2` eliminada a mitad de 2000 guardados → 2000/2000 confirmados, 0 ACK perdidos, réplica sana 13 s después de arrancarla (PRUEBAS_CARGA). Backup verificado por restauración. El 99,5 % requiere un entorno representativo |
| EAC-03 | Reconexión, antigüedad ≤15 s, sin duplicados | Implementado: cola local persistente, autoguardado ≤15 s y al cambiar, reenvío al reconectar, versiones idempotentes, sin tiempo extra (integración + frontend + E2E) |
| EAC-04 | Auditoría con actor/antes/después y rechazo de alteración | Implementado y probado en integración: actor, antes/después, rechazo de UPDATE/DELETE/TRUNCATE y detección de manipulación |
| EAC-05 | Borrador/sección denegados y TLS ≥1.2 | Permisos probados; la matrícula se sincroniza desde el registro SIMULADO. Compose sirve HTTPS con TLS 1.2/1.3 (TLS 1.1 rechazado en el smoke) con certificado autofirmado local; un certificado institucional es pendiente de producción |
| EAC-06 | Reintentos del legado y alerta sin interrumpir LMS | Implementado: 1 llamada + 3 reintentos con backoff, ejecución FAILED, alerta SYSTEM_ALERT al ADMIN y LMS operativo (integración y E2E con el registro SIMULADO en modo caída) |
| EAC-07 | Cambiar proveedor/algoritmo sin modificar núcleo | Puertos AcademicRegistry y PlagiarismProvider con adaptadores SIMULADOS intercambiables; Strategy de calificación por tipo |
| EAC-08 | Pruebas sin BD y cobertura núcleo ≥80% | Reglas de calificación y aprobación probadas sin BD; cobertura del núcleo 99% de líneas (VERIFICACION) |

| Restricción | Tratamiento |
| --- | --- |
| RES-01/02 | Integraciones por puertos implementadas con servicios SIMULADOS; el LMS consume el registro y delega el plagio al proveedor, sin reemplazarlos |
| RES-03 | Cumplido para notas y evaluaciones publicadas mediante auditoría atómica (ADR-008) |
| RES-04 | Adaptada por instrucción explícita; ADR-002 |
| RES-05 | Hexágonos y perfiles DTO, pruebas AST y unitarias |
| RES-06 | Repositorio/CI creados; equipo Scrum y GitHub Projects no configurados por esta entrega |
| RES-07 | «Nube» simulada con Docker Compose local (2 réplicas, TLS, rol mínimo, backups); despliegue en nube real fuera del alcance autorizado |
| RES-08 | SPA responsiva; Chrome/Firefox/Edge/Safari vigentes requieren matriz de pruebas posterior |

HU-01 → etapa 4; HU-02 → etapa 3; HU-03 → etapas 3/8; HU-04 → etapa 5; HU-05 → etapa 2. ON-1…ON-6 conservan su vínculo CAR del informe; ningún objetivo de negocio se declara logrado por el scaffold.
