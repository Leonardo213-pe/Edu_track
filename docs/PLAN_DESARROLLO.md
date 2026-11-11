# Plan incremental

Cada etapa termina con build, pruebas de permisos/invariantes, integración real, arquitectura y trazabilidad actualizada. Ninguna etapa autoriza merge automático o despliegue a nube.

| Etapa | Alcance | Criterio de salida |
| --- | --- | --- |
| 0: base, terminada | Fuente analizada; límites de 14 módulos; identidad inicial; SPA; PostgreSQL; Compose; CI | Base compilada y probada; ver verificación histórica |
| Fase 2: identidad, actual | CAR-13: alta/edición, roles/estado, perfil, sesiones revocables, contraseñas, correo real, eventos | PostgreSQL/SMTP reales, permisos de cuatro roles, protección concurrente del último ADMIN, tests de arquitectura y pantallas conectadas |
| 1: cursos, pendiente | CAR-01, CU-06: sílabo, unidades, sesiones | Propiedad por docente y sección, dominio puro, edición concurrente y ausencia de acceso estudiantil a borrador |
| 2: contenido y revisión | CAR-02/03, CU-02/10; versiones, Borrador/En revisión/Publicado/Archivado | Solo diseñador aprueba versión válida; estudiantes ven solo publicado y matriculado; almacenamiento probado |
| 3: banco y calificación | CAR-04/06; CU-07/08; preguntas/snapshots, Strategy, rúbricas/pesos; base de auditoría CAR-12 | Soluciones nunca en DTO estudiantil, reglas de redondeo acordadas, nota/auditoría atómicas y auditoría inalterable |
| 4: exámenes críticos | CU-03, CAR-11, EAC-01/02/03; intentos, tiempo servidor, autoguardado, reconexión, finalización | Idempotencia/reordenamiento/vencimiento, sin pérdida de ACK; carga y failover en entorno representativo; no certificar por unit tests |
| 5: matrículas externas | CAR-09, RES-01, CU-12; contrato SOAP/REST real, scheduler 02:00, conciliación | Sandbox institucional, altas/bajas/secciones idempotentes, reintentos/fallo/alerta; sin matrícula oficial manual |
| 6: tareas y plagio | CAR-05/10, CU-04/15; archivos y proveedor externo | Cuotas, permisos, recepción durable, outbox/inbox/reintentos; contrato real y errores del proveedor |
| 7: colaboración y analítica | CAR-07/08, CU-05/09/11; foros, notificaciones, riesgo por reglas | Moderación, ACL por curso, métricas trazables, cero ML |
| 8: administración y operación | CAR-14, CU-14; observabilidad, auditoría consultable, recuperación | TLS ≥1.2, privilegios mínimos, backups restaurados, SLO medidos, nube según autorización |

La entrega 1.0 del PDF agrupa más características; la etapa 0 actual es únicamente la primera base solicitada, no toda esa entrega ni la PoC final del informe. La auditoría se adelanta a cualquier escritura de notas/exámenes publicados para evitar deuda de integridad.

Antes de etapas dependientes: resolver preguntas de `ANALISIS_REQUISITOS.md`, obtener contratos de proveedores y datos de carga autorizados. No inventar fechas de entrega, rendimiento ni endpoints externos. Un sprint sugerido por el informe es de dos semanas; no se promete ese plazo sin estimación del equipo.
