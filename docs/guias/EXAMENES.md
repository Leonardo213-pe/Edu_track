# Exámenes en línea — fase 5

Decisiones en [ADR-009](../ADR/009-examenes-concurrentes.md). Requiere un cuestionario **publicado** (fase 4, [EVALUACIONES.md](EVALUACIONES.md)) en un curso publicado con el estudiante inscrito.

## Uso

**Estudiante** (Evaluaciones → «Rendir / continuar»):
- Ve el número de preguntas, la duración y la fecha de cierre. Al comenzar, el servidor sortea sus preguntas y fija el vencimiento.
- Cada respuesta se guarda al elegirla y cada 15 s. El indicador muestra «Todas las respuestas guardadas», «Guardando…» o «Sin conexión: N respuestas pendientes, se reenviarán».
- Si recarga la página o pierde la conexión, al volver recupera lo confirmado y se reenvía lo pendiente. El tiempo sigue corriendo según el servidor.
- «Finalizar examen» cierra el intento. Si vence el tiempo, el sistema lo cierra con lo guardado.
- La nota aparece en segundos. No se muestran las respuestas correctas.

**Docente** (Evaluaciones → «Intentos»): estado (en curso, finalizado o cerrado por tiempo), inicio, fin, preguntas respondidas y nota.

La nota automática entra en el promedio ponderado y queda en la auditoría como «Sistema (calificación automática)».

## API (`/api/exams`, Bearer JWT)

| Método / ruta | Función |
| --- | --- |
| GET `/assessments/:assessmentId/attempt` | Estudiante: datos del examen, `canStart`, su intento (si existe), hora del servidor y nota |
| POST `/assessments/:assessmentId/attempt` | Inicia o retoma (idempotente); devuelve preguntas sin respuestas correctas, vencimiento y hora del servidor |
| GET `/attempts/:attemptId` | Reanudar: preguntas, últimas respuestas confirmadas con su `version`, `remainingSeconds` y nota |
| PUT `/attempts/:attemptId/answers/:questionId` | `{optionIds, version}` → `{accepted, version, optionIds, savedAt}`; ACK tras el commit; 409 `ATTEMPT_CLOSED` si venció o finalizó |
| POST `/attempts/:attemptId/finalize` | Finaliza (idempotente) y encola `AttemptFinalized.v1` |
| GET `/assessments/:assessmentId/attempts` | Docente responsable o ADMIN: intentos sin respuestas |

Errores:

| HTTP | Código |
| --- | --- |
| 400 | INVALID_INPUT: opción ajena a la pregunta, más de una opción en preguntas de única respuesta o versión inválida |
| 403 | FORBIDDEN: no inscrito, otro estudiante o rol incorrecto |
| 404 | NOT_FOUND |
| 409 | NOT_AVAILABLE (cerrado o fuera de plazo), ATTEMPT_CLOSED |

## Protocolo de versiones (para otros clientes)

- Usar una versión entera por pregunta, empezando en 1 y aumentando en cada cambio.
- Reenviar siempre la misma versión ante un error de red.
- Si la respuesta trae una `version` igual o mayor que la enviada, la respuesta está confirmada.
- Si trae `accepted: false`, el servidor ya tenía una versión igual o más nueva.

## Pruebas

```powershell
npm run check
npm run test:integration   # incluye exams.integration (ver README para la BD desechable)
$env:STUDENTS = '200'; $env:SAVES = '10'; npm.cmd run test:load   # carga local contra edutrack_test
$env:COURSES_E2E = 'true'; $env:ASSESSMENTS_E2E = 'true'; npm.cmd run test:e2e
```

`test:load` solo se ejecuta contra `edutrack_test` y guarda el resultado en `tmp/load/`. Sus cifras son locales y no certifican la capacidad en producción.
