# ADR-012: despliegue en AWS

Estado: aceptado el 11 de noviembre de 2026 (rama `feat/despliegue-render`, que empezó como preparación para Render y terminó en AWS por decisión del usuario, que dispone de 200 USD de crédito). Sigue el ADR-007 del informe (fig. 12) con las desviaciones de ADR-001 (sin Worker), ADR-009 (sin Redis) y el outbox transaccional (sin SQS). Guía: [DESPLIEGUE_AWS.md](../operacion/DESPLIEGUE_AWS.md).

## Decisiones

1. **Topología:**
   - La SPA va en S3 detrás de CloudFront, que envía `/api/*` a un ALB. El ALB solo reenvía si llega la cabecera secreta `X-Origin-Verify`, generada en Secrets Manager.
   - ECS Fargate ejecuta 2 tareas de la API (0,25 vCPU, 1 GB; medido localmente: ~200 MB en reposo).
   - Cada tarea arranca un contenedor `migrate` (migraciones con el propietario y aprovisionamiento de `edutrack_app`) antes del contenedor `api`. La API se conecta como `edutrack_app`.
   - RDS PostgreSQL 17 cifrado, sin acceso público y con Multi-AZ opcional.
   - El registro SIMULADO es una tarea interna resuelta por Cloud Map (`registry.edutrack.local`).
   - Subredes públicas con IP pública para las tareas, protegidas por grupos de seguridad, para evitar el NAT Gateway (~32 USD/mes).
2. **Almacenamiento de objetos** (`platform/storage/blob-store.ts`):
   - Puerto técnico `BlobStore` con dos implementaciones: sistema de archivos (las mismas rutas de antes) y un cliente S3 mínimo propio con firma SigV4. No se añadió el SDK de AWS: npm falló con un bug de arborist en workspaces, y 4 operaciones no lo justifican.
   - En AWS usa las **credenciales temporales del rol de tarea** (endpoint de credenciales de ECS, con caché hasta 5 min antes de que caduquen); las claves estáticas quedan para R2/MinIO.
   - Los adaptadores de `courses` y `submissions` mantienen su validación y solo cambian dónde guardan los bytes.
   - Los anclajes de auditoría pasan a ser objetos `anchors/<id>-<fecha>.json` en el bucket versionado, fuera del proveedor de la base de datos.
3. **Conexiones:** `DB_POOL_MAX` limita el pool de cada módulo (`platform/persistence/pool-size.ts`); en AWS vale 3 por réplica.
4. **TLS a RDS:** la imagen incluye el bundle oficial de CA de RDS y el runtime usa `sslmode=verify-full`. La CLI de migraciones de Prisma usa `sslmode=require` (cifrado).
5. **Secretos:** generados por Secrets Manager, sin signos de puntuación para que sean seguros dentro de una URL, e inyectados por ECS. Ninguno está en Git ni en la plantilla.
6. **Operación:** `scripts/aws/deploy.ps1` construye y sube las imágenes, despliega el stack, publica la SPA, ejecuta tareas puntuales (crear el ADMIN, sembrar la data demo) y pausa o reanuda. `apps/api/scripts/seed-demo.cjs` crea la data demo ficticia a través de la API y exige `SEED_DEMO=true`.

## Consecuencias y límites

- No se ha desplegado en una cuenta real: requiere las credenciales del usuario. La plantilla está validada con cfn-lint y los componentes nuevos se probaron en local (S3 real, imagen, 52/52 de integración).
- Con el dominio `*.cloudfront.net` no se puede exigir TLS ≥ 1.2 en el visor. Exigirlo requiere un dominio propio y un certificado de ACM (parámetros opcionales).
- `TrustProxy=2` (CloudFront + ALB) debe confirmarse tras el primer despliegue con la IP registrada en «Eventos de seguridad».
- La contraseña inicial del ADMIN viaja como parámetro de la tarea puntual: hay que cambiarla tras el primer acceso.
- El limitador de peticiones sigue en memoria por réplica (pendiente desde ADR-007/011).
- Costo estimado: ~50 USD/mes (~65 con Multi-AZ); `-Pause` reduce el gasto entre usos.
