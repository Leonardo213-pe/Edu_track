# Despliegue en AWS

Arquitectura del informe (fig. 12, ADR-007 del informe) con las decisiones de este repositorio ([ADR-012](../ADR/012-despliegue-aws.md)). Plantilla: [`infra/aws/edutrack.yaml`](../../infra/aws/edutrack.yaml). Script: [`scripts/aws/deploy.ps1`](../../scripts/aws/deploy.ps1).

```
Navegador ──HTTPS──► CloudFront ──► S3 (SPA)
                         └─ /api/* ──► ALB (solo con cabecera secreta de CloudFront)
                                        └──► ECS Fargate: api × 2 (contenedor migrate previo en cada tarea)
                                                ├──► RDS PostgreSQL 17 (TLS verificado, rol edutrack_app)
                                                ├──► S3 versionado: materiales, entregas, anclajes de auditoría (rol IAM de la tarea)
                                                └──► registry.edutrack.local:4010 (Registro Académico SIMULADO, Fargate)
Secrets Manager: contraseñas de BD, JWT, clave del registro y del origen · CloudWatch Logs: /edutrack/<stack>
```

| Informe | Este despliegue | Motivo |
| --- | --- | --- |
| CloudFront + S3, ALB, ECS Fargate, RDS, S3, CloudWatch | Igual | — |
| Fargate Worker separado | No: los trabajos corren dentro de la API | ADR-001, probado con 2 réplicas |
| ElastiCache Redis | No | ADR-009: autoguardado durable en PostgreSQL |
| SQS | No: outbox transaccional en PostgreSQL | Misma función con atomicidad; SQS sería otro adaptador |
| RDS Multi-AZ | Parámetro `DbMultiAZ` (por defecto `false`) | Duplica el costo; actívalo para la exposición |
| WAF | No incluido | Costo; el ALB solo acepta tráfico que trae la cabecera secreta de CloudFront |

## Costo aproximado (us-east-2)

ALB ~16 USD/mes, 2 tareas API (0,25 vCPU/1 GB) + registro ~20 USD/mes, RDS db.t4g.micro ~13 USD/mes (Multi-AZ ~26), S3/CloudFront/Secrets/Logs ~3 USD/mes. **Total ~50 USD/mes** (~65 con Multi-AZ). Con 200 USD de crédito: unos 3-4 meses, más si usas `-Pause` entre usos. Revisa la caducidad de tus créditos en Billing → Credits y crea una alerta en Budgets.

## Requisitos

- Cuenta de AWS con un usuario o SSO con permisos para CloudFormation, ECS, ECR, EC2/VPC, ELB, RDS, S3, CloudFront, IAM, Secrets Manager, Cloud Map y Logs.
- [AWS CLI v2](https://aws.amazon.com/cli/) configurado (`aws configure` o `aws sso login`), Docker Desktop y Node 24 (`$env:Path = "$PWD\.tools\node-v24.22.2-win-x64;$env:Path"`).

## Pasos

```powershell
.\scripts\aws\deploy.ps1 -Region us-east-2            # 1. imágenes a ECR, stack (15-25 min la primera vez) y SPA
.\scripts\aws\deploy.ps1 -Region us-east-2 -CreateAdmin   # 2. primer ADMIN admin@institucion.edu.pe (pide contraseña)
.\scripts\aws\deploy.ps1 -Region us-east-2 -SeedDemo      # 3. opcional: data demo ficticia (misma contraseña)
```

Al terminar, el script imprime la URL (`https://xxxx.cloudfront.net`). Cada nueva versión: repetir el paso 1 (las tareas aplican las migraciones al arrancar).

- Pausar o reanudar: `-Pause` deja la API en 0 réplicas y detiene RDS (AWS la vuelve a arrancar a los 7 días); `-Resume` la reanuda. El ALB y CloudFront siguen cobrando poco.
- Eliminar todo: `aws cloudformation delete-stack --stack-name edutrack`. RDS deja un snapshot final y el bucket de archivos se conserva; bórralos a mano si ya no los necesitas.

## Después del primer despliegue

1. Entra con el ADMIN y **cambia su contraseña**: viajó como parámetro de una tarea puntual de ECS.
2. **IP del cliente:** abre «Eventos de seguridad» e inicia sesión. La IP registrada debe ser tu IP pública. Si aparece una IP de AWS, ajusta el parámetro `TrustProxy` (por defecto `2`: CloudFront + ALB). Si no coincide, los límites de login se aplicarían a todos a la vez.
3. **TLS:** con la URL `*.cloudfront.net`, AWS no permite exigir TLS ≥ 1.2 (los navegadores actuales negocian 1.3). Para forzarlo usa `-DomainName` y `-CertificateArn` (certificado ACM en us-east-1).
4. **Correo:** no hay SMTP configurado; la recuperación de contraseña queda registrada como fallida. Añade `SMTP_*` de un proveedor con TLS (Amazon SES, Brevo…) en la definición de tarea si la necesitas.

## Qué está verificado y qué no

Verificado en local:
- La plantilla pasa `cfn-lint` 1.60 sin avisos.
- La imagen se construye con el bundle de CA de RDS, legible por el usuario `node`.
- El adaptador S3 funciona contra un servidor S3 real (SeaweedFS) con claves y con credenciales temporales tipo rol de tarea.
- El driver local sigue leyendo los archivos existentes.
- Integración 52/52.

**No se ha desplegado en una cuenta de AWS real**, porque requiere tus credenciales. El primer despliegue es la prueba: si algún paso falla, los logs están en CloudWatch (`/edutrack/<stack>`, prefijos `migrate/`, `api/` y `registry/`).
