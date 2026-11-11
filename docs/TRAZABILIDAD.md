# Matriz de trazabilidad

Fuente: informe pp. 6-10, 12 y 35. «Pendiente» incluye directorios diseñados; no implica código operativo. Las pruebas de identidad no prueban las reglas académicas futuras.

| Requisito | Casos de uso | Módulos responsables | Verificación prevista / existente | Estado |
| --- | --- | --- | --- | --- |
| CAR-01: sílabo y estructura | CU-01,06 | courses | Composite (avance y duración), PostgreSQL, edición/orden/eliminación en borrador nunca publicado, propietario, revisión optimista, historial, navegador | Implementado fase 3 (ADR-006/007) |
| CAR-02: multimedia versionado | CU-02,06 | courses según ADR-006 | Archivos reales, bytes/hash, historial sin sobreescritura, enlaces HTTP(S), descargas autorizadas | Implementado con almacenamiento local; S3 futuro por puerto |
| CAR-03: aprobación | CU-10 | courses según ADR-006 | State (transiciones, editabilidad, visibilidad), rechazo con observaciones, aprobación solo diseñador, reapertura retira publicación, archivado, decisiones e historial inmutables ante UPDATE | Implementado fase 3 |
| CAR-04: banco/aleatoriedad/reloj | CU-03,07 | assessments, exams | Snapshots, sorteo, vencimiento, no soluciones | Pendiente |
| CAR-05: archivos | CU-04 | submissions | Autorización, cuota/tipo/tamaño, persistencia | Pendiente |
| CAR-06: notas/rúbricas/promedios | CU-08 | grading | Strategy, pesos, redondeo, transacción auditoría | Pendiente |
| CAR-07: foros/notificaciones | CU-05,09 | collaboration | Moderación, suscripción, entrega idempotente | Pendiente |
| CAR-08: progreso/riesgo | CU-01,11 | courses (completitud), analytics (proyecciones) | Composite/idempotencia/versión vigente y actividad observada | Completitud básica implementada; conexión/riesgo/analítica pendientes |
| CAR-09: matrícula nocturna | CU-12 | enrollments | Proyección persistida, conciliación idempotente altas/bajas, bitácora de solo inserción (ADR-007); contrato legado, planificador 02:00 y reintentos | Parcial: proyección y conciliación implementadas con lista oficial entregada por ADMIN; adaptador SOAP/REST y planificador pendientes |
| CAR-10: plagio externo | CU-04,15 | plagiarism, submissions | Contrato sandbox/fallos del tercero | Pendiente |
| CAR-11: concurrencia/durabilidad | CU-03 | exams | k6 + caída/reconexión; EAC-01/02/03 | Diseño/plan de carga; sin módulo |
| CAR-12: auditoría inmutable | CU-08,14 | audit, grading, assessments | UPDATE/DELETE rechazados, cadena, atomicidad | Diseño; sin tablas/endpoints |
| CAR-13: usuarios/roles | CU-13 | identity | Unitarias, HTTP/Prisma/PostgreSQL/SMTP, frontend y navegador | Fase 2 implementada: alta administrativa, edición/listado, cuatro roles, activación/baja lógica, perfil, contraseñas, sesiones revocables y registro de seguridad |
| CAR-14: monitoreo | CU-11 | administration, analytics | Métricas, panel y alarmas | Solo health técnico; requisito pendiente |

| Escenario | Objetivo del informe | Estado y evidencia |
| --- | --- | --- |
| EAC-01 | 3.000 concurrentes, p95 ≤1 s, cero pérdida confirmada | Plan de carga, no ejecutado |
| EAC-02 | Recuperación ≤5 min, disponibilidad 99,5% | Diseño futuro, Compose una réplica no lo valida |
| EAC-03 | Reconexión, antigüedad ≤15 s, sin duplicados | Diseño futuro, falta exámenes |
| EAC-04 | Auditoría con actor/antes/después y rechazo de alteración | Pendiente |
| EAC-05 | Borrador/sección denegados y TLS ≥1.2 | Identidad/RBAC/propietario/curso publicado/matrícula y descargas probados. Matrícula consumida de la proyección persistida (ADR-007), sin fixtures; adaptador CAR-09 pendiente; TLS producción requiere HTTPS, no lo certifica Compose HTTP |
| EAC-06 | Reintentos del legado y alerta sin interrumpir LMS | Pendiente; resolver ambigüedad 3 intentos/reintentos |
| EAC-07 | Cambiar proveedor/algoritmo sin modificar núcleo | Puertos y arquitectura probados en identidad; proveedores/Strategy pendientes |
| EAC-08 | Pruebas sin BD y cobertura núcleo ≥80% | Umbral configurado y medido en identidad; ver VERIFICACION |

| Restricción | Tratamiento |
| --- | --- |
| RES-01/02 | Integraciones por puertos planificadas, sin reemplazar legado ni motor de plagio |
| RES-03 | Bloqueante antes de publicar cambios de nota/examen; ADR-004 |
| RES-04 | Adaptada por instrucción explícita; ADR-002 |
| RES-05 | Hexágonos y perfiles DTO, pruebas AST y unitarias |
| RES-06 | Repositorio/CI creados; equipo Scrum y GitHub Projects no configurados por esta entrega |
| RES-07 | Contenedores locales/pruebas; nube pendiente de autorización |
| RES-08 | SPA responsiva; Chrome/Firefox/Edge/Safari vigentes requieren matriz de pruebas posterior |

HU-01 → etapa 4; HU-02 → etapa 3; HU-03 → etapas 3/8; HU-04 → etapa 5; HU-05 → etapa 2. ON-1…ON-6 conservan su vínculo CAR del informe; ningún objetivo de negocio se declara logrado por el scaffold.
