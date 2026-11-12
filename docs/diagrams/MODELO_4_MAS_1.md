# Modelo 4+1

## Vista lógica

Identidad actual: User protege email/nombre/rol/estado/versión y produce UserProfile. IdentityService coordina repositorio transaccional/hash/token/sesiones/recuperación por puertos. El SMTP sale desde un consumidor interno del outbox de recuperación. Cada módulo futuro posee su modelo; no se comparte una entidad User global con Prisma. Detalle de fase 2 en ADR-005 y el contrato de API.

```mermaid
classDiagram
  class User { +id: string
    +email: string
    +displayName: string
    +role: Role
    +profile() UserProfile }
  class IdentityService { +login()
    +authenticate()
    +createUser()
    +listUsers() }
  class UserRepository { <<interface>>
    +findById()
    +findByEmail()
    +create()
    +list() }
  class PasswordHasher { <<interface>>
    +hash()
    +verify() }
  class AccessTokens { <<interface>>
    +issue()
    +verify() }
  IdentityService --> User
  IdentityService --> UserRepository
  IdentityService --> PasswordHasher
  IdentityService --> AccessTokens
```

Modelo académico: estructura/progreso Composite y ciclo State implementados en Courses, según [clases y componentes](CURSOS_DIAGRAMAS.md). Calificación Strategy, interacción Observer/eventos e integraciones externas permanecen pendientes; no hay clases vacías para aparentar patrones.

## Vista de procesos

Acceso implementado:

```mermaid
sequenceDiagram
  actor U as Usuario
  participant W as React
  participant H as HTTP Nest
  participant S as IdentityService
  participant R as Repositorio Prisma
  participant D as PostgreSQL
  U->>W: Correo y contraseña
  W->>H: POST /identity/login
  H->>H: Límite y validación DTO
  H->>S: login
  S->>R: findByEmail(normalizado)
  R->>D: Consulta usuario
  D-->>S: Usuario por adaptador
  S->>S: Verificar scrypt
  alt Credenciales válidas
    S-->>W: JWT 15 min y perfil seguro
    W->>H: GET /identity/me, Bearer
    H->>S: authenticate
    S->>R: Obtener usuario actual por sub verificado
    S-->>W: Perfil y rol actual
  else Credenciales inválidas
    S-->>W: 401 genérico
  end
```

Examen previsto (CU-03): autorización de matrícula/ventana → snapshot/vencimiento → autoguardado versionado durable cada ≤15 s → reconexión/reenvío → finalización idempotente → nota/auditoría/outbox atómicos → proyecciones asíncronas internas. Esta secuencia todavía no es ejecutable. Sincronización y plagio se aislarán con scheduler/consumidores dentro del mismo backend.

## Vista de desarrollo

```mermaid
flowchart TB
  WEB[apps/web] -->|JSON HTTP| HTTP[infrastructure/http]
  HTTP --> APP[application / puertos]
  APP --> DOMAIN[domain]
  APP --> PUBLIC[public]
  OUT[infrastructure/persistence y security] -->|implementa puertos| APP
  OUT --> DOMAIN
  MODULE[IdentityModule: composición] --> HTTP
  MODULE --> OUT
  MODULE --> APP
```

Workspaces y pruebas AST preservan la dirección; dominio/aplicación sin dependencias externas. Esquema y migraciones dentro de API, CLI en infraestructura del módulo. Los trece módulos planificados mantienen carpetas, no servicios ficticios.

## Vista física

```mermaid
flowchart LR
  Browser[Navegador local] -->|localhost:8080| N[Nginx sin privilegios / SPA]
  subgraph Docker[Docker Compose, red privada edutrack]
    N --> API[Un contenedor API / usuario node]
    API --> PG[(PostgreSQL)]
    PG --- VOL[Volumen persistente]
  end
  Tests[Tests host / CI] -->|55432 o servicio CI| TestDB[(PostgreSQL desechable aislado)]
```

Producción futura requiere HTTPS/TLS ≥1.2, varias réplicas del mismo backend, BD recuperable, backups verificados, secretos administrados, scheduler con lease, límites de recursos y observabilidad. AWS del informe es una opción documentada, no un despliegue realizado. Compose una réplica no satisface EAC-02.

## +1: escenarios que conectan las vistas

| Escenario | Estado | Vistas / evidencia |
| --- | --- | --- |
| CU-13, administración de identidad | Fase 2 funcional | Alta/edición/roles/estado/perfil, sesiones revocables, contraseñas y correo, eventos; PostgreSQL/SMTP reales y UI |
| CU-03, examen con desconexión | Pendiente | Intento/snapshot, procesos de ACK/reenvío, almacenamiento durable; EAC-01/03 |
| CU-08, cambio de nota | Pendiente | Strategy, transacción nota/auditoría, tabla append-only; EAC-04 |
| CU-10, aprobación | Pendiente | State y versión revisada, contrato review/courses; EAC-05 |
| CU-12, sincronización | Pendiente | Puerto legado, scheduler interno, conciliación idempotente; EAC-06 |
