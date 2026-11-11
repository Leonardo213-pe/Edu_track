# Plan incremental

Cada etapa termina con build, pruebas de permisos/invariantes, integración real, arquitectura y trazabilidad actualizada. Ninguna etapa autoriza merge automático o despliegue a nube.

| Etapa | Alcance | Criterio de salida |
| --- | --- | --- |
| 0: base, terminada | Fuente analizada; límites de 14 módulos; identidad inicial; SPA; PostgreSQL; Compose; CI | Base compilada y probada; ver verificación histórica |
| Fase 2: identidad, terminada | CAR-13: usuarios/roles/sesiones/contraseñas/eventos | Publicada en feat/identity-complete; base del PR de etapa 3, sin merge automático |
| Fase 3: cursos y contenidos, terminada | CAR-01/02/03: curso/sílabo/unidades/sesiones, archivos/versiones, revisión, completitud | PostgreSQL/archivos/navegador reales; roles/propietario/matrícula probados; ADR-006, OpenAPI y trazabilidad |
| Fase 4: banco y calificación, terminada (ADR-008) | CAR-04/06; CU-07/08; preguntas/snapshots, Strategy, rúbricas/pesos; base de auditoría CAR-12 | Soluciones nunca en DTO estudiantil, reglas de redondeo acordadas, nota/auditoría atómicas y auditoría inalterable |
| Fase 5: exámenes críticos, terminada (ADR-009; certificación de carga pendiente) | CU-03, CAR-11, EAC-01/02/03; intentos, tiempo servidor, autoguardado, reconexión, finalización | Idempotencia/reordenamiento/vencimiento, sin pérdida de ACK; carga y failover en entorno representativo; no certificar por unit tests |
| Fase 6: adaptador de matrículas externas | CAR-09, RES-01, CU-12; contrato SOAP/REST real, scheduler 02:00, conciliación | Sandbox institucional, altas/bajas/secciones idempotentes, reintentos/fallo/alerta; sin matrícula oficial manual |
| Fase 7: tareas y plagio | CAR-05/10, CU-04/15; archivos y proveedor externo | Cuotas, permisos, recepción durable, outbox/inbox/reintentos; contrato real y errores del proveedor |
| Fase 8: colaboración y analítica | CAR-07/08, CU-05/09/11; foros, notificaciones, riesgo por reglas | Moderación, ACL por curso, métricas trazables, cero ML |
| Fase 9: administración y operación | CAR-14, CU-14; observabilidad, auditoría consultable, recuperación | TLS ≥1.2, privilegios mínimos, backups restaurados, SLO medidos, nube según autorización |

La entrega 1.0 del PDF agrupa más características; la etapa 0 actual es únicamente la primera base solicitada, no toda esa entrega ni la PoC final del informe. La auditoría se adelanta a cualquier escritura de notas/exámenes publicados para evitar deuda de integridad.

Numeración unificada tras la auditoría del 12/11/2026: fase 1 base, fase 2 identidad, fase 3 cursos y contenidos (terminada con el cierre de ADR-007), **fase 4 banco de preguntas y calificación** (motor de evaluaciones, CAR-04/06 con la base de auditoría CAR-12) y fase 5 exámenes concurrentes. La fase 3 agrupa los antiguos incrementos «cursos» y «contenido/revisión». La matrícula ya existe como proyección persistida alimentada por la lista oficial que entrega el ADMIN; el adaptador del Registro Académico y su planificador siguen en la fase 6. Pendientes operativos académicos en CURSOS.md.

Antes de etapas dependientes: resolver preguntas de `ANALISIS_REQUISITOS.md`, obtener contratos de proveedores y datos de carga autorizados. No inventar fechas de entrega, rendimiento ni endpoints externos. Un sprint sugerido por el informe es de dos semanas; no se promete ese plazo sin estimación del equipo.
