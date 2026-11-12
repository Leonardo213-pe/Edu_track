# Evaluaciones, calificaciones y auditoría — fase 4

Decisiones en [ADR-008](../ADR/008-evaluaciones-calificacion-auditoria.md).

## Uso en la interfaz

Pestañas del detalle de curso:

- **Banco de preguntas** (docente responsable o ADMIN): bancos por curso. Cada pregunta es de opción única, opción múltiple o verdadero/falso, con su puntaje. Una pregunta retirada no entra en sorteos nuevos.
- **Evaluaciones:**
  - El docente crea un **cuestionario aleatorio** (banco, preguntas por intento y duración) o una **tarea con rúbrica** (criterios con puntaje máximo), con peso y fecha límite.
  - Publica la evaluación (el curso debe estar PUBLICADO), la cierra, elimina borradores y genera una vista previa del sorteo.
  - El estudiante inscrito ve las evaluaciones publicadas, sus notas y su promedio ponderado.
- **Calificaciones** (docente responsable; ADMIN solo lectura): una tabla de estudiantes inscritos por evaluación, con su promedio. El docente califica con la rúbrica. Para cambiar una nota debe indicar el motivo, y el cambio queda auditado.

Navegación del ADMIN: **Auditoría**. Registros de notas y evaluaciones publicadas con su valor anterior y nuevo, y botón «Verificar integridad de la cadena».

Reglas:
- Escala 0–20 con dos decimales; el promedio final se redondea al entero (,5 sube) y se aprueba con 11.
- La suma de pesos de un curso no puede superar el 100 %.
- El promedio «acumulado» cuenta con 0 lo no calificado; el «promedio de lo calificado» considera solo lo ya evaluado.

## API

Todas las rutas requieren Bearer JWT. OpenAPI: [openapi.json](../openapi.json).

| Método / ruta (`/api`) | Permiso / función |
| --- | --- |
| GET, POST `/assessments/courses/:courseId/banks` | Docente responsable o ADMIN; listar (con respuestas) o crear `{name}` |
| POST `/assessments/banks/:bankId/questions` | `{type, statement, points, options[{text, correct}]}` |
| PATCH `/assessments/questions/:questionId` | Igual que la anterior, más `version` y `active` |
| GET `/assessments/courses/:courseId` | Personal: definición completa. Estudiante inscrito en curso publicado: solo publicadas, sin banco ni respuestas |
| POST `/assessments/courses/:courseId` | `{title, instructions, type: QUIZ|RUBRIC, weight, dueAt, durationMinutes, questionCount, bankId | criteria[]}` |
| PATCH `/assessments/:id` | Más `revision`. Publicada: solo título, instrucciones, peso y fecha (auditado) |
| POST `/assessments/:id/publish` · `/close` | `{revision}` |
| DELETE `/assessments/:id?revision=` | Solo borrador |
| GET `/assessments/:id/preview` | Sorteo de ejemplo con respuestas; solo personal responsable |
| GET `/grading/courses/:courseId/gradebook` | Docente responsable o ADMIN |
| POST `/grading/assessments/:assessmentId/students/:studentId` | Docente responsable: `{awards[{criterionId, points}], version?, reason?}` |
| GET `/grading/courses/:courseId/me` | Estudiante inscrito: sus notas y promedio |
| GET `/audit/entries?entity=GRADE|ASSESSMENT&entityId=&limit=&offset=` | ADMIN |
| GET `/audit/verify` | ADMIN; `{checked, valid, firstInvalidId}` |

Códigos de error:

| HTTP | Código |
| --- | --- |
| 400 | INVALID_INPUT, WEIGHT_EXCEEDED, INSUFFICIENT_QUESTIONS, NOT_ENROLLED, REASON_REQUIRED |
| 403 | FORBIDDEN |
| 404 | NOT_FOUND |
| 409 | CONFLICT, INVALID_STATE, COURSE_NOT_PUBLISHED, NOT_GRADABLE |

## Garantías verificadas

- Las respuestas correctas no aparecen en ninguna respuesta para el estudiante.
- El snapshot publicado no cambia aunque cambie el banco, y rechaza UPDATE y DELETE.
- Cada alta o cambio de nota, la publicación y cada cambio de una evaluación publicada generan una entrada de auditoría **en la misma transacción**, con actor, valor anterior y valor nuevo.
- Un cambio por SQL sin actor declarado falla.
- Las entradas de auditoría rechazan UPDATE, DELETE y TRUNCATE.
- La verificación detecta una entrada alterada aunque se desactive el trigger.

## Pruebas

```powershell
npm run check
# integración: ver README (base edutrack_test desechable)
$env:COURSES_E2E = 'true'; $env:ASSESSMENTS_E2E = 'true'; npm.cmd run test:e2e
```

`ASSESSMENTS_E2E` deja en la base de desarrollo una evaluación publicada, notas y auditoría de QA, que son inmutables por diseño. Usarlo solo en entornos locales.

## Pendiente (fases siguientes)

- **Fase 5:** rendir el cuestionario contra reloj, autoguardado idempotente, reconexión y calificación automática de cada intento con `AutomaticGrading`.
- **Fase 7:** entregas de archivos enlazadas a la rúbrica.
- **Producción:** rol de base de datos sin privilegios de propietario y anclaje externo del hash de auditoría.
