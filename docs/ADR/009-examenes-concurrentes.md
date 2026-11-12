# ADR-009: exámenes contra reloj, autoguardado durable y calificación por outbox (fase 5)

Estado: aceptado el 14 de noviembre de 2026. Implementa CU-03 (tabla 10, fig. 6), CAR-11, EAC-01 y EAC-03, y la parte de rendir contra reloj de CAR-04. Confirma la propuesta del ADR-004 del repositorio y sustituye el buffer Redis del ADR-003 del informe. Mantiene el backend único (ADR-001).

## Decisiones

1. **Módulo `exams`** (esquema propio) con `attempts`, `answers` y `outbox`. Depende de identity, courses, enrollments, assessments y grading, sin ciclos.

2. **Intento**
   - Un intento por estudiante y evaluación (clave única).
   - Iniciar dos veces, incluso de forma simultánea, devuelve el mismo intento.
   - El servidor fija `expiresAt` = mín(inicio + duración, fecha límite).
   - Las preguntas se sortean del snapshot inmutable de la fase 4 (`AssessmentCatalog.drawForAttempt`) y se guardan en el intento **sin las marcas de respuesta correcta**.
   - Un trigger impide cambiar preguntas, tiempos o dueño, modificar un intento finalizado o borrar intentos y respuestas.

3. **Autoguardado (CAR-11, EAC-01)**
   - Hay una fila por intento y pregunta. Cada respuesta lleva una **versión monotónica del cliente**.
   - `INSERT … ON CONFLICT DO UPDATE … WHERE version < nueva` solo guarda versiones mayores. Los duplicados y las versiones atrasadas devuelven el estado guardado (`accepted: false`), así que reintentar es seguro.
   - La validez del intento se decide con el **reloj de PostgreSQL** (`clock_timestamp()`), bajo un `FOR SHARE` del propio intento: los estudiantes no compiten entre sí. Además, un trigger rechaza cualquier respuesta a un intento cerrado.
   - **El ACK se envía después del commit**. No hay buffer en memoria ni Redis, porque no está demostrada su durabilidad.
   - Las respuestas tienen un pool de conexiones propio y un límite de 300 peticiones/min por cliente en esa ruta.

4. **Reconexión (EAC-03, flujo A1)**
   - La SPA guarda en `localStorage` las respuestas sin confirmar, con su versión.
   - Las reenvía al reconectar (evento `online`), cada ≤ 15 s y después de cada cambio.
   - Al reanudar, el servidor devuelve la última versión confirmada y la SPA reenvía solo las respuestas locales más nuevas.
   - El temporizador usa el desfase con la hora del servidor; una desconexión no da tiempo extra.

5. **Finalización y vencimiento (flujos 4 y A2)**
   - `UPDATE … WHERE status = 'IN_PROGRESS' RETURNING` atómico: SUBMITTED, o EXPIRED si ya venció.
   - En la **misma transacción** se escribe `AttemptFinalized.v1` en el outbox.
   - Un barredor dentro del mismo backend (`FOR UPDATE SKIP LOCKED`, seguro con varias réplicas) cierra los vencidos con lo guardado. Además, cualquier consulta cierra un intento que ya venció.

6. **Calificación automática (flujo 5)**
   - Un consumidor del outbox dentro del backend toma un evento con `SKIP LOCKED` y reintenta con backoff exponencial (hasta 10 intentos, guardando el último error).
   - Obtiene la clave de respuestas por contrato interno y llama a `GradeRecorder.recordAutomatic`, que aplica la `AutomaticGrading` (Strategy de la fase 4) **solo a las preguntas sorteadas**.
   - Es **idempotente por intento** (`sourceId`), también ante consumidores concurrentes.
   - La nota se audita con el actor `SYSTEM_ACTOR_ID` («Sistema (calificación automática)»).
   - Una caída entre el commit de la nota y el del outbox solo produce un reintento sin efecto.

7. **Visibilidad**
   - El estudiante ve su nota al finalizar, pero no la corrección pregunta por pregunta, para no revelar el banco.
   - El docente ve los intentos (estado, horas, respondidas y nota) sin las respuestas.

## Alternativas descartadas

- **Redis como buffer con consolidación periódica (ADR-003 del informe).** Sin un fsync y una replicación probados, puede perder respuestas confirmadas.
- **Bloqueo pesimista del intento durante todo el examen.**
- **WebSockets.** Más complejidad sin necesidad demostrada.
- **Calificar dentro de la transacción de finalización.** Acoplaría las transacciones de dos módulos.

## Evidencia y límites

- La carga local (`npm run test:load`, 200 estudiantes × 10 guardados simultáneos, un proceso, PostgreSQL en Docker) dio:
  - 2000/2000 respuestas 200 y **0 respuestas confirmadas perdidas**;
  - p50 485 ms, p95 724 ms, p99 859 ms;
  - 200/200 intentos calificados en 5,3 s.

  No certifica EAC-01 (3000 concurrentes, p95 ≤ 1 s) ni EAC-02 (99,5 %, recuperación ≤ 5 min). Ambos requieren varias réplicas, PostgreSQL gestionado y la red real ([PRUEBAS_CARGA.md](../operacion/PRUEBAS_CARGA.md)).
- El reinicio de la API a mitad del examen se probó en integración: las respuestas confirmadas se conservan y el vencimiento no cambia.
- Pendiente:
  - barajar las opciones por intento;
  - varios intentos con regla de nota;
  - adaptaciones de tiempo por estudiante;
  - monitorización del outbox (CAR-14, fase 9).
