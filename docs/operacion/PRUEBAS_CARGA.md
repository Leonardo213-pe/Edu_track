# Plan de carga y resiliencia

Estado: **mediciones locales ejecutadas (un proceso y Compose con 2 réplicas y caída inducida); certificación pendiente.** Los exámenes y el autoguardado existen desde la fase 5 ([ADR-009](../ADR/009-examenes-concurrentes.md)). No se debe medir solo salud o login y presentarlo como capacidad de exámenes. Herramienta prevista para el entorno representativo: k6, en generadores separados de las réplicas del LMS.

## Medición local ejecutada (fase 5)

El script `apps/api/test/load/autosave.load.mjs` (`npm run test:load`) actúa así:
- Solo funciona contra `edutrack_test`.
- Precrea los usuarios, inicia sesión con IP simulada por estudiante y crea curso, matrícula, banco de 20 preguntas y cuestionario de 10 preguntas por intento.
- En la fase medida, todos los estudiantes guardan a la vez.
- Después reconcilia cada ACK con PostgreSQL, finaliza todos los intentos y espera la calificación automática.

| Fecha | Entorno | Carga | Resultado |
| --- | --- | --- | --- |
| 2026-11-14 | Un proceso API local (Windows) y PostgreSQL 17 en Docker (tmpfs) | 200 estudiantes × 10 guardados, todos simultáneos (2000 PUT) | 2000/2000 HTTP 200, **0 ACK perdidos**, p50 485 ms, p95 724 ms, p99 859 ms, máx. 930 ms, 390 guardados/s; 200/200 intentos calificados en 5,3 s |

## Medición con 2 réplicas y caída de una réplica (cierre, ADR-011)

Mismo script en modo Compose: `LOAD_BASE_URL=https://localhost:8443/api` contra Nginx (HTTPS) y las réplicas `api` y `api2`, levantadas con `docker compose -f compose.yaml -f compose.loadtest.yaml up -d --wait`. El override apunta las réplicas a la base desechable `edutrack_test` y conserva `X-Forwarded-For` (solo carga) para simular 200 IP de estudiantes. Con `KILL_REPLICA=api2 KILL_AT=0.5 RESTART_AFTER_MS=20000`, el script ejecuta `docker compose kill api2` al 50 % de los guardados y `start` 20 s después. Si un guardado falla, el cliente lo reenvía con la misma versión, como la cola de la SPA.

```powershell
$env:TEST_DATABASE_URL = "postgresql://edutrack_test:$($env:TEST_DB_PASSWORD)@localhost:55432/edutrack_test?schema=identity"
docker compose -f compose.yaml -f compose.loadtest.yaml up -d --wait
$env:LOAD_BASE_URL = 'https://localhost:8443/api'; $env:KILL_REPLICA = 'api2'; $env:STUDENTS = '200'; $env:SAVES = '10'
npm run test:load
docker compose up -d --wait   # volver a la configuración de desarrollo
```

| Fecha | Entorno | Carga | Resultado |
| --- | --- | --- | --- |
| 2026-11-11 | Nginx HTTPS + 2 réplicas + PostgreSQL 17 desechable (tmpfs), todo en Docker Desktop (Windows 11), sin caída | 200 × 10 guardados simultáneos | 2000/2000 HTTP 200, **0 ACK perdidos**, p50 374 ms, **p95 867 ms**, p99 1032 ms, máx. 1375 ms, 435 guardados/s; 200/200 calificados en 3,7 s |
| 2026-11-11 | Igual, `api2` eliminada a los 2,95 s (50 %) y arrancada a los 23,5 s | 200 × 10 guardados simultáneos | 2000/2000 HTTP 200, todos al primer intento (Nginx reenvió al otro servidor), **0 ACK perdidos**, p50 451 ms, **p95 2318 ms**, p99 2514 ms, máx. 2741 ms, 278,7 guardados/s; 200/200 calificados en 4,6 s; `api2` sana 13 s después de arrancarla |

El primer intento con caída se abortó durante la preparación con HTTP 500 `TooManyConnections`: cada réplica abre hasta ~100 conexiones (un pool por módulo) y PostgreSQL tenía 100. Se configuró `max_connections=300` en `compose.yaml` y `compose.test.yaml`; para producción hay que dimensionar los pools o usar PgBouncer.

Lectura: sin fallo, el p95 queda por debajo del objetivo de 1 s; **durante la caída de una réplica el p95 sube a 2,3 s**, por encima del objetivo, aunque sin perder ninguna respuesta confirmada. La recuperación de capacidad (13 s) está muy por debajo de los 300 s de EAC-02.

Estos resultados **no certifican EAC-01 ni EAC-02**: una réplica, la máquina del desarrollador, sin red real y 200 y no 3000 estudiantes. Los escenarios siguientes siguen pendientes en un entorno representativo.

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
