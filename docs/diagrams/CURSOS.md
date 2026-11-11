# Clases y componentes académicos

```mermaid
classDiagram
  Course "1" *-- "0..*" Unit
  Unit "1" *-- "0..*" Session
  Session "1" *-- "0..*" Material
  Material "1" *-- "1..*" ContentVersion
  Course "1" *-- "0..*" Review
  Course --> CourseState
  CourseState <|.. Draft
  CourseState <|.. InReview
  CourseState <|.. Published
  CourseState <|.. Archived
  AcademicComponent <|.. AcademicGroup
  AcademicComponent <|.. MaterialLeaf
  AcademicGroup o-- AcademicComponent
  class AcademicComponent { <<interface>>
    +count(completed) }
  class Course { +edit()
    +addUnit()
    +addSession()
    +addVersion()
    +transition()
    +progress() }
```

```mermaid
flowchart LR
  UI[React CoursesWorkspace] --> HTTP[Controller / DTO / CourseAuthGuard]
  HTTP --> USE[CourseService]
  HTTP -->|contrato público| ID[IdentityDirectory]
  USE --> DOMAIN[Course / State / Composite]
  USE --> PORTS[Repository / Identity / Enrollment / Storage / Runtime]
  P[PrismaCourseRepository] -. implementa .-> PORTS
  F[LocalCourseStorage] -. implementa .-> PORTS
  I[Adaptador de identidad] -. implementa .-> PORTS
  I --> ID
  E[Adaptador de matrícula] -. implementa .-> PORTS
  E --> EN[EnrollmentAccess público]
  P --> DB[(PostgreSQL esquema courses)]
  F --> VOL[Volumen course_files]
  COM[CoursesModule: composición] -. inyecta .-> USE
```

Los espacios planificados `materials` y `course-review` no acceden a estas tablas ni están conectados como módulos ficticios. Sus capacidades se implementan cohesivamente en courses según ADR-006. Matrícula institucional sigue pendiente; adaptador por defecto deniega y el fixture solo se habilita explícitamente.

```mermaid
stateDiagram-v2
  [*] --> BORRADOR
  BORRADOR --> EN_REVISION: responsable/ADMIN envía completo
  EN_REVISION --> BORRADOR: diseñador rechaza con observaciones
  EN_REVISION --> PUBLICADO: diseñador aprueba
  PUBLICADO --> BORRADOR: responsable/ADMIN inicia nueva revisión
  BORRADOR --> ARCHIVADO: archivar
  PUBLICADO --> ARCHIVADO: archivar
  ARCHIVADO --> [*]
```
