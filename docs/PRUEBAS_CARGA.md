# Plan de carga y resiliencia

Estado: **medición local ejecutada; certificación pendiente.** Los exámenes y el autoguardado existen desde la fase 5 ([ADR-009](ADR/009-examenes-concurrentes.md)). No se debe medir solo salud o login y presentarlo como capacidad de exámenes. Herramienta prevista para el entorno representativo: k6, en generadores separados de las réplicas del LMS.

## Medición local ejecutada (fase 5)

El script `apps/api/test/load/autosave.load.mjs` (`npm run test:load`) actúa así:
- Solo funciona contra `edutrack_test`.
- Precrea los usuarios, inicia sesión con IP simulada por estudiante y crea curso, matrícula, banco de 20 preguntas y cuestionario de 10 preguntas por intento.
- En la fase medida, todos los estudiantes guardan a la vez.
- Después reconcilia cada ACK con PostgreSQL, finaliza todos los intentos y espera la calificación automática.

| Fecha | Entorno | Carga | Resultado |
| --- | --- | --- | --- |
| 2026-11-14 | Un proceso API local (Windows) y PostgreSQL 17 en Docker (tmpfs) | 200 estudiantes × 10 guardados, todos simultáneos (2000 PUT) | 2000/2000 HTTP 200, **0 ACK perdidos**, p50 485 ms, p95 724 ms, p99 859 ms, máx. 930 ms, 390 guardados/s; 200/200 intentos calificados en 5,3 s |

Este resultado **no certifica EAC-01 ni EAC-02**: una réplica, la máquina del desarrollador, sin red real y 200 y no 3000 estudiantes. Los escenarios siguientes siguen pendientes en un entorno representativo.

## Datos y ambiente

3.000 estudiantes ficticios diferentes, matriculados en secciones autorizadas, cada uno con intento propio y snapshot publicado. Precrear usuarios/tokens/intentos fuera de la fase medida; no cargar login por cada guardado. Validar expiración de tokens durante el ensayo. No usar datos reales ni incluir soluciones en fixtures públicos. Fijar duración del examen > duración del escenario, política de autoguardado, payload y red institucional (por confirmar). Registrar versiones, recursos, réplicas, pool de conexiones, latencia de red, configuración de durabilidad y semilla de datos.

## Escenarios y aceptación

| ID | Ejecución | Criterio / evidencia |
| --- | --- | --- |
| EAC-01 / ramp | 0→3.000 usuarios en 5 min; mantener 10 min; cada uno guarda cada 15 s con jitter | Aproximadamente 200 guardados/s sostenidos. p95 de guardados válidos ≤1.000 ms; toda respuesta confirmada reconciliada con almacenamiento durable |
| EAC-01 / ráfaga | 3.000 intentos guardan simultáneamente; repetir tras inicio y en cierre | Medir p95 ≤1 s como objetivo del informe; registrar timeouts, saturación, conexiones y locks; no garantizar ausencia literal de locks internos de PostgreSQL |
| EAC-01 / cierre | Finalizar los 3.000 intentos en la misma ventana | Finalización idempotente, una nota y auditoría consistente, cero respuestas confirmadas perdidas |
| EAC-03 / red | Cortar la red de una cohorte 30-60 s, conservar pendientes y reconectar antes/después de vencimiento | Reenvío mismo ID/versión sin duplicados; versiones viejas no sobrescriben; máximo 15 s entre guardados con red disponible; servidor no amplía vencimiento |
| EAC-02 / caída | Durante carga pico, terminar una réplica de API en entorno de varias réplicas | Continuidad por réplicas restantes, recuperación capacidad ≤300 s; contrastar disponibilidad 99,5% con ventana completa y definición de fallos |
| Durabilidad | Tras registrar IDs/valores/versión de todos los ACK, reiniciar componente de persistencia y fallar réplica | Comparación exhaustiva después de recuperación: faltantes=0, duplicados=0; si se adopta Redis probar también fsync/failover y pérdida de nodo |
| EAC-04 / integridad | Cambios de nota concurrentes más intentos SQL de UPDATE/DELETE auditoría con rol de app | Cambios atómicos, cadena verificable y todos los intentos de alteración rechazados |
| EAC-06 / terceros | Legado/plagio con latencia/fallos durante examen | Las llamadas externas no bloquean respuestas; reintentos/alertas observables y jobs idempotentes |

Los 3.000 usuarios son un supuesto del informe (p. 5), no una cifra institucional confirmada. Se distinguen solicitudes válidas de rechazos esperados por plazo/autorización; no esconder errores 5xx/timeout ni descartar mediciones lentas. EAC-02 necesita estrategia de failover y monitor externo; Compose local de una réplica no sirve como certificación.

## Umbrales y reporte

Definir en k6 `http_req_duration{operation:autosave}: p(95)<=1000`, contadores específicos de errores inesperados y ACK reconciliados, e informes por escenario/replica. Aceptar solo cero pérdida de ACK confirmados. La tasa de error tolerada adicional no está fijada por el PDF; acordarla con la institución sin inventar un umbral vinculante.

Guardar resumen k6, métricas API/DB (pool, esperas/locks, CPU/memoria), IDs de ACK, resultados del reconciliador y cronología del fallo. Ejecutar repetidamente con datos limpios, después de un warmup identificado. No subir tokens/secretos a Git. El reconciliador consulta exclusivamente la base de pruebas autorizada. Agregar scripts reales cuando los endpoints y los contratos estén implementados; no entregar stubs que reporten éxito.
