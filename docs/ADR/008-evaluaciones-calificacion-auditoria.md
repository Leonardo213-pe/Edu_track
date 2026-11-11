# ADR-008: motor de evaluaciones, calificación y auditoría inmutable (fase 4)

Estado: aceptado el 13 de noviembre de 2026. Implementa CAR-04 (banco de preguntas y sorteo), CAR-06 (calificación con Strategy y promedios), CAR-12 y EAC-04 (auditoría inmutable) y CU-07, CU-08 y CU-14. Se basa en el ADR-004 (diseño propuesto) y en el informe (figs. 3, 4, 17 y 18, tabla 22 y su ADR-004). No cambia el backend único ni el stack.

## Decisiones

1. **Tres módulos con esquema propio:**
   - `assessments`: bancos, preguntas, evaluaciones y snapshot.
   - `grading`: notas y promedios.
   - `audit`: entradas encadenadas.

   Las dependencias declaradas (`modules.json`) forman un grafo acíclico:
   - `assessments` → identity, courses, enrollments, audit.
   - `grading` → identity, courses, enrollments, assessments, audit.
   - `audit` → identity.

   Para conocer curso, docente y estado se añadió `CourseCatalog.describe`; para los inscritos, `EnrollmentAccess.studentsOf`.

2. **Escala acordada:**
   - Vigesimal 0–20.
   - Las notas se guardan en centésimas enteras y se redondean a 2 decimales (half-up).
   - El promedio final se redondea al entero (,5 sube).
   - Se aprueba con 11.
   - En opción múltiple la calificación es todo o nada.
   - Pesos en puntos base, con una suma por curso que no supera el 100 %.

   No se usa aritmética en coma flotante.

3. **Banco y snapshot:**
   - Las preguntas son de opción única, opción múltiple o verdadero/falso, con validación por tipo. Siempre se pueden mejorar (versión optimista) o retirar.
   - Publicar un cuestionario exige un **curso PUBLICADO** y suficientes preguntas activas. Al publicar se copia el pool a `assessments.snapshot_questions`, que es inmutable (trigger contra UPDATE y DELETE).
   - Los cambios posteriores del banco no alteran lo publicado.
   - Las respuestas correctas nunca forman parte de las vistas de estudiante ni del contrato `AssessmentCatalog`.

4. **Ciclo de vida (State):** BORRADOR → PUBLICADA → CERRADA.

   | Estado | Qué permite |
   | --- | --- |
   | BORRADOR | Cambiarlo todo; se puede eliminar |
   | PUBLICADA | Solo cambiar título, instrucciones, peso y fecha; no cambiar tipo, banco, número de preguntas, duración ni rúbrica |
   | CERRADA | Ninguna modificación |

   Las evaluaciones PUBLICADAS y CERRADAS aceptan notas y las ven los estudiantes inscritos. Una evaluación publicada no se puede borrar (trigger).

5. **Sorteo:** Fisher–Yates parcial, sin repetición, con fuente aleatoria inyectada (`crypto.randomInt` en producción, determinista en pruebas). En esta fase solo existe la vista previa del docente; cada intento sorteará en la fase 5.

6. **Strategy (fig. 3):** `GradingStrategy` con `AutomaticGrading` (objetivas, todo o nada) y `RubricGrading` (criterios entre 0 y su máximo, escalado a 20), elegidas por tipo mediante `strategyFor`. La rúbrica se usa ya desde la interfaz del docente. La automática está implementada y probada, pero se conectará a intentos reales en la fase 5.

7. **Notas:**
   - Solo el **docente responsable** califica, y solo a estudiantes **inscritos**. El ADMIN las consulta.
   - Cada cambio de nota exige la versión vigente (optimista) y un **motivo**.
   - Las notas no se borran (trigger).
   - El estudiante ve solo sus notas y su promedio, sin el motivo interno.

8. **Auditoría atómica con hash encadenado (CAR-12/EAC-04):**
   - `audit.entries` guarda entidad, ID, acción, valores anterior y nuevo (JSONB), actor, fecha UTC con microsegundos, `prevHash` y `hash`. El hash es SHA-256 sobre un texto canónico que incluye el ID y el hash previo.
   - El contrato de escritura del módulo `audit` es la **función de base de datos `audit.append_entry`**, que serializa la cadena con un lock transaccional. Los demás módulos no escriben en tablas de auditoría.
   - `grading.grades` (INSERT y UPDATE) y `assessments.assessments` (UPDATE de publicadas o al publicar) tienen el trigger `audit.record_row_change`. Así **ninguna nota ni evaluación publicada puede cambiar sin su entrada de auditoría en la misma transacción**, incluso si el cambio se hace por SQL.
   - El actor se declara con `set_config('edutrack.actor', …, true)`; si falta, la transacción falla.
   - Hay triggers contra UPDATE, DELETE y TRUNCATE de `audit.entries`.
   - `audit.verify_chain()` recalcula toda la cadena y localiza la primera entrada alterada.
   - El ADMIN consulta la auditoría y la verifica (CU-14).

## Alternativas descartadas

- **Escribir la auditoría desde el código de cada módulo.** Requeriría compartir la transacción entre clientes Prisma o tablas ajenas, y permitiría cambios sin auditoría por SQL directo.
- **Eventos en memoria o outbox para la auditoría.** Es consistencia eventual; CAR-12 exige atomicidad.
- **Event sourcing completo.** Desproporcionado para la fase.

## Consecuencias y límites

- La cadena única serializa las escrituras auditadas (notas y cambios de evaluaciones publicadas). No afecta al autoguardado de exámenes, que no se audita por respuesta. Si la carga lo exige, el ADR-004 prevé particionar por agregado con anclaje global.
- Un superusuario de PostgreSQL puede desactivar triggers y reescribir toda la cadena. La verificación detecta alteraciones parciales (probado), pero no una reescritura completa. Para producción se requieren un rol de aplicación sin privilegios de propietario, `REVOKE UPDATE/DELETE` y el anclaje periódico del último hash fuera de la base. Ambos pendientes.
- Las notas, evaluaciones publicadas y entradas de auditoría de QA quedan en la base donde se ejecutan las pruebas E2E (`ASSESSMENTS_E2E=true`), porque son inmutables por diseño.
- **Fase 5:** intentos contra reloj, autoguardado idempotente, calificación automática del intento y evento `AttemptFinalized`.
- **Fase 7:** entregas de archivos, que se enlazarán con la rúbrica.
