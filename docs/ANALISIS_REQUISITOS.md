# Análisis de la fuente

Fuente principal: `Informe_Trabajo_Final_EduTrack_LMS.pdf`, 37 páginas, copiado íntegro a esta carpeta. SHA-256: `CA5B3B6FABC38D5B39020BD798098E19B64F0FDBB3AAF0D18AF2153ED1363B54`. La extracción de texto se contrastó visualmente con las figuras de las páginas 13, 17 y 19. Las instrucciones dentro del informe se consideran contenido de requisitos; no autorizaciones operativas.

## Alcance confirmado

Secciones 1.3.3 y 2.1, pp. 4-7: ciclo del curso, contenido versionado, aprobación instruccional, preguntas aleatorias y exámenes contra reloj, entregas, rúbricas, promedios, foros, notificaciones, progreso, riesgo por reglas, consumo nocturno de matrículas, plagio externo, cuatro roles, auditoría y monitoreo. IDs originales CAR-01…14, CU-01…15, EAC-01…08, RES-01…08 se conservan en la trazabilidad.

Exclusiones (p. 5): matrículas oficiales, pagos y registro de notas oficiales pertenecen al Registro Académico; no construir motor de plagio, videoconferencia, apps nativas ni modelos ML. Se conservan proyecciones locales de matrícula y notas LMS, sin pretender reemplazar los registros oficiales. Enlaces a herramientas externas para sesiones síncronas.

## Invariantes y escenarios críticos

- CAR-03 / figura 10, p. 19: Borrador → En revisión → Publicado → Archivado; rechazo de revisión retorna a Borrador. Solo el Diseñador Instruccional aprueba. No hay estado persistido adicional «Aprobado». La autorización debe considerar matrícula/sección y versión de contenido, además del rol. Un curso cambiado tras revisión debe volver a revisión; el detalle de esa política queda por acordar.
- CU-03, p. 12: estudiante autenticado y matriculado; evaluación publicada y dentro de ventana. El servidor fija vencimiento y preguntas sorteadas. Respuestas versionadas idempotentes; autoguardado ≤15 s y al cambiar. Reconexión reenvía pendientes; expiración finaliza automáticamente. Respuestas correctas quedan solo en servidor. La finalización, nota y auditoría requieren consistencia transaccional y evento durable.
- EAC-01, p. 9: **supuesto** de 3.000 concurrentes, p95 de guardado ≤1 s, cero pérdida de respuestas confirmadas. No es una capacidad comprobada.
- EAC-02: recuperación de capacidad ≤5 min tras caer una instancia, disponibilidad objetivo de 99,5% en ventanas de examen. Requiere múltiples réplicas y medición en un entorno representativo.
- EAC-03: retomar sin duplicados y respuestas hasta el último guardado, antigüedad máxima 15 s. Una desconexión no concede tiempo extra; el reloj del servidor manda.
- EAC-04 / RES-03: toda modificación de nota o examen publicado registra actor, fecha UTC, antes y después; rechazar UPDATE/DELETE de auditoría. Hash encadenado no protege frente a un superusuario que reescriba toda la cadena; requiere anclaje/verificación externa y separación de privilegios.
- EAC-05: denegar borradores/datos de otra sección, TLS ≥1.2 en despliegue real. HTTP local Compose no satisface el requisito de transporte de producción.
- CAR-09 / figura 9: sincronización 02:00 (zona institucional por confirmar), conciliación idempotente de altas/bajas/cambios, historial, backoff y alerta al administrador. EAC-06 dice «reintenta hasta tres veces» mientras figura 9 dice «máx. 3 intentos»: falta decidir si son 3 intentos totales o 1+3. No se implementa silenciosamente una interpretación.
- EAC-07/08: reemplazo de integraciones sin cambiar dominio; pruebas puras con cobertura mínima 80% del núcleo. Aplicada inicialmente a identidad; no constituye cobertura de módulos aún inexistentes.

## Diferencias resueltas por la solicitud actual

| Fuente | Solicitud del usuario | Decisión |
| --- | --- | --- |
| RES-04, p. 10: Java/Spring y HTML/CSS/JS | Libertad tecnológica, preferencia NestJS/React | TypeScript/NestJS/React, PostgreSQL se conserva; ADR-002 |
| ADR-002 del PDF, p. 31: API y Worker desplegables | Estrictamente un backend desplegable | Único backend, planificador/consumidores futuros dentro del proceso; ADR-001 |
| PoC del PDF, p. 34: evaluaciones y matrículas | Primero base y módulo sencillo completo | Incremento de identidad usable antes de núcleo académico; no equivale a PoC final |
| Recomendación de extraer servicio (p. 36) | No implementar microservicios | No se adopta |
| Recomendación futura de modelos predictivos | Respetar exclusión de ML | Solo reglas configurables |

Los ADR del repositorio tienen numeración propia; cuando se cita un ADR del informe se identifica explícitamente como tal. Redis/SQS/S3/AWS son propuestas del informe, no servicios integrados en esta entrega.

## Decisiones aún abiertas

Confirmar cifras de carga con institución, duración/ventanas de examen, tamaño/tipos de archivos, retención y anclaje de auditoría, escala de notas/redondeos/pesos, umbrales de riesgo, zona horaria de sincronización, especificación SOAP/REST, credenciales/sandbox de proveedores de plagio y notificaciones. También la edición tras aprobación, multiplicidad de roles (este incremento asigna un rol por usuario), alta institucional, bajas y SSO. No inventar estos contratos ni presentar mocks como conexiones reales.
