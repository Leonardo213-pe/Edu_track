# ADR-004: garantías futuras de exámenes y auditoría

Estado: propuesta de diseño, **no implementada**. Contexto: CAR-11/12 y EAC-01/03/04. El informe ADR-003 usa Redis persistente como buffer con consolidación periódica a PostgreSQL. Persistencia habilitada sin política de fsync/replicación no demuestra cero pérdida de respuestas confirmadas.

Decisión propuesta: ACK solo tras escritura durable verificable. Evaluar primero upsert PostgreSQL con control optimista por intento/pregunta y transacción corta. Si la carga demuestra necesidad de Redis, exigir configuración y ensayos de failover que satisfagan durabilidad; no confirmar una respuesta que solo vive en memoria. Cliente reintenta mismo identificador/versión, servidor rechaza reemplazos antiguos y aplica ventana/vencimiento autoritativos. Publicación de eventos críticos por outbox transaccional y consumidor alojado en el backend único.

Calificación/cambio de examen publicado y auditoría de solo inserción forman una transacción. Hash encadenado, permisos sin UPDATE/DELETE, trigger y verificación externa; no basta una cadena sin separar privilegios. Evitar contención de una cadena global mediante partición explícita por agregado y anclaje global periódico, sujeto a validación académica.

Alternativas: aplicar Redis del informe sin verificar durabilidad, eventos solo en memoria, auditoría eventual. No cumplen la garantía sin pruebas adicionales. La elección final PostgreSQL/Redis y el diseño transaccional entre módulos requieren ADR aceptado y resultados de carga antes de implementarse como estándar.
