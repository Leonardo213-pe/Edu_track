# Resumen de entrega del proyecto EduTrack LMS

EduTrack es un LMS universitario construido como **monolito modular hexagonal**: un único backend NestJS desplegable, una SPA React y PostgreSQL. Tiene 12 módulos de negocio con dominio, aplicación, infraestructura y contrato público; una prueba AST impide imports indebidos, ciclos y el acceso a tablas de otro módulo. La fuente funcional es el [informe original](../Informe_Trabajo_Final_EduTrack_LMS.pdf). Las decisiones están en los [ADR](../ADR) y la evidencia ejecutada en [VERIFICACION.md](../operacion/VERIFICACION.md).

## Qué está implementado y es real

Todo lo siguiente funciona de punta a punta con PostgreSQL real, en el navegador y con pruebas automatizadas:

| Capacidad | Requisitos | Notas |
| --- | --- | --- |
| Usuarios, roles, sesiones revocables, recuperación por correo | CAR-13 | SMTP real; Mailpit captura los correos en local |
| Cursos, sílabo, unidades/sesiones, materiales versionados, revisión instruccional, avance | CAR-01/02/03 | Archivos reales con validación por contenido |
| Banco de preguntas, sorteo, calificación Strategy, promedios 0–20 | CAR-04/06 | Las respuestas correctas nunca llegan al estudiante |
| Exámenes contra reloj con autoguardado durable y reconexión | CAR-11, EAC-01/03 | Versión monotónica, ACK tras el commit, calificación por outbox |
| Auditoría inmutable con hash encadenado | CAR-12, EAC-04 | Escrita en la misma transacción. Rol de BD sin UPDATE/DELETE en auditoría y anclaje del último hash en un volumen separado |
| Foros, notificaciones en la bandeja, riesgo por reglas | CAR-07/08 | Sin aprendizaje automático (exclusión del informe) |
| Matrículas: proyección, conciliación idempotente, planificador 02:00 America/Lima, 3 reintentos, alertas | CAR-09, EAC-06 | Lógica, planificador y alertas reales; **la fuente es el registro SIMULADO** |
| Tareas: entrega de archivos con plazo del servidor, versiones, outbox, calificación con rúbrica | CAR-05 | Real |
| Control de similitud asíncrono, idempotente y con reintentos | CAR-10 | Consumidor real; **el proveedor es SIMULADO** |
| Panel de monitoreo (p50/p95, errores, colas, intentos, trabajos) con alertas por umbral | CAR-14 | Métricas reales de todas las réplicas |
| Operación: 2 réplicas tras Nginx, TLS ≥ 1.2, rol mínimo de BD, backup verificado por restauración | EAC-02, EAC-05 | En Docker Compose local |

## Qué está SIMULADO y por qué

| Elemento | Cómo se simula | Por qué | Cómo se sustituye |
| --- | --- | --- | --- |
| Registro Académico institucional | Servicio REST propio en un contenedor aparte (`infra/registry`), con estudiantes ficticios por sección y modo caída | No hay acceso al sistema ni al contrato SOAP/REST de la universidad | Nuevo adaptador del puerto `AcademicRegistry`; el resto no cambia |
| Proveedor de plagio | `SIMULADO-NGRAM-v1`: similitud por 3-gramas contra las entregas del curso | No hay contrato con un proveedor; el informe excluye construir un motor propio | Adaptador del puerto `PlagiarismProvider` |
| «Nube» | Docker Compose local: 2 réplicas, Nginx, PostgreSQL y volúmenes | Sin cuenta ni autorización de nube | Mismas imágenes con BD gestionada, balanceador y secretos gestionados |
| Certificado TLS | Autofirmado, generado al primer arranque | Entorno local | Certificado institucional o ACME montado en la misma ruta |

En la interfaz, el registro y los informes de similitud muestran la insignia **SIMULADO**, y el código lo indica en sus comentarios y nombres.

## Resultados medidos (locales, no certificación)

| Escenario | Resultado |
| --- | --- |
| 200 estudiantes × 10 guardados simultáneos con 2 réplicas | p95 867 ms, 0 respuestas confirmadas perdidas |
| Lo mismo eliminando una réplica a mitad de la carga | 2000/2000 confirmados, 0 perdidos, p95 2,3 s durante la caída, réplica recuperada en 13 s |
| Pruebas | 147 unitarias de backend (98,33 % de líneas del núcleo), 28 de frontend, 48 de integración, arquitectura 7/7, E2E de navegador y smoke |

**No se certifican los 3000 usuarios concurrentes ni el 99,5 % de disponibilidad**: requieren un entorno representativo ([PRUEBAS_CARGA.md](../operacion/PRUEBAS_CARGA.md)).

## Pendiente para producción

- Contratos reales del Registro Académico y del proveedor de plagio.
- Limitador de peticiones compartido entre réplicas (hoy en memoria por réplica).
- Dimensionar los pools de conexión o usar PgBouncer (hoy `max_connections=300`).
- Correo y push para las notificaciones.
- Certificado institucional, monitor externo y CI remoto.
- Prueba de carga de 3000 estudiantes en un entorno representativo.
