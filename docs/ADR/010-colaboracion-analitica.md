# ADR-010: foros, notificaciones y analítica de riesgo (fase 8)

Estado: aceptado el 15 de noviembre de 2026. Implementa CAR-07 y CAR-08, y CU-05, CU-09 y CU-11. Sigue la fig. 5 (Observer) y la fig. 19 (ER de foros). Respeta la exclusión del informe: el riesgo se calcula con reglas, no con aprendizaje automático.

## Decisiones

1. **`collaboration`** (esquema propio) gestiona foros por curso o por unidad, hilos, mensajes, suscripciones y la bandeja de notificaciones.

   | Rol | Acceso |
   | --- | --- |
   | Docente responsable y ADMIN | Moderan |
   | Estudiante inscrito en un curso publicado | Participa |
   | Diseñador instruccional | Solo lee |

   - Moderar significa ocultar un mensaje con motivo, cerrar un hilo o fijarlo. El texto de un mensaje nunca se edita (lo impide un trigger); moderar solo lo oculta.
   - Un estudiante ve «Mensaje oculto por moderación». El personal ve el texto y el motivo.

2. **Observer:**
   - `DiscussionThread.publish` notifica a los observadores `TeacherNotifier` (NotificadorDocente) y `SubscriberNotifier` (NotificadorEstudiante).
   - Quien publica queda suscrito.
   - Las notificaciones llevan una clave de deduplicación.

3. **Notificaciones en la aplicación** (campana con contador y marcar como leídas):
   - **Respuestas y hilos nuevos** en los foros.
   - **Vencimientos:** un recordatorio dentro del mismo backend, cada 5 min, avisa una sola vez por estudiante 48 h antes de cada evaluación publicada. Es idempotente gracias a la clave de deduplicación.
   - **Notas:** `grading` llama al contrato `NOTIFICATION_SENDER` después de confirmar la nota. Es *best effort*: si el aviso se pierde, la nota sigue siendo durable y auditada.

4. **`analytics`** (esquema propio):
   - **Tiempo de conexión:** la SPA envía una señal por minuto mientras el curso está visible. Solo se cuenta un minuto si pasaron ≥ 50 s desde la anterior, con el reloj de la base, y los días se agrupan en la zona America/Lima.
   - **Riesgo:** se calcula a partir del avance en materiales (`CourseCatalog.progressOf`), el promedio (`GRADE_READER.standing`), las evaluaciones vencidas sin nota y los días sin actividad.
   - **Reglas por curso:** avance mínimo, promedio mínimo, días máximos sin actividad y evaluaciones vencidas toleradas. Cada regla incumplida es un motivo visible: ninguno = BAJO, uno = MEDIO, dos o más = ALTO.
   - **Permisos:** el docente responsable y el ADMIN configuran las reglas; el diseñador consulta.

5. **Dependencias nuevas, sin ciclos:**
   - `collaboration` → identity, courses, enrollments, assessments.
   - `grading` → collaboration.
   - `analytics` → identity, courses, enrollments, assessments, grading.

   Nuevos contratos: `CourseCatalog.units` y `progressOf`, `AssessmentCatalog.dueBetween`, `GRADE_READER` y `NOTIFICATION_SENDER`.

## Límites

- Las notificaciones no se envían por correo ni push. ON-4 se cumple en la aplicación; el envío externo queda pendiente.
- La analítica se calcula al consultar. Si la escala lo exige, se pasará a proyecciones alimentadas por eventos.
