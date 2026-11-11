# ADR-002: stack TypeScript

Estado: aceptado. Contexto: RES-04 del informe propone Java/Spring/HTML; el usuario concede libertad y prefiere NestJS/React/PostgreSQL/Prisma.

Decisión: Node 24 LTS, NestJS 11, TypeScript 5.9, React 19/Vite 7, PostgreSQL 17 y Prisma 7 con driver pg y cliente CommonJS generado dentro del adaptador. Npm workspaces y lockfile para reproducibilidad. NestJS 11 permite mantener una composición convencional CommonJS; no se fuerza una migración de major a Nest 12 en este primer incremento. DTO no exponen tipos Prisma. Vitest, Testing Library, Supertest y pruebas AST sustituyen JUnit/ArchUnit/WireMock; los contratos externos aún no existen. k6 queda definido para carga futura.

Alternativas: implementar RES-04 literalmente, adoptar un ORM de dominio o prescindir de React. Se prioriza la preferencia explícita actual y lenguaje común sin acoplar el dominio al framework.

Consecuencias: se debe justificar la diferencia en la entrega académica; Prisma 7 requiere adapter-pg, configuración explícita y generación antes de compilar. Versiones exactas en lockfile. Referencias: [Prisma 7](https://www.prisma.io/docs/orm/v7), [generación](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators), [Vite](https://vite.dev/guide/), [versiones Nest](https://docs.nestjs.com/faq/versions).

Verificación de ejecución: el generador usa `importFileExtension = "js"` para que los imports funcionen después de compilar; compilar sin esta opción no prueba que el cliente arranque. La imagen Debian slim incorpora OpenSSL para el motor de migraciones. Vitest/coverage están fijados en 5.1.0 tras identificar avisos de seguridad en el major 3 inicialmente evaluado; se verificó compatibilidad con Node 24/Vite 7 y se repitió toda la suite. [Migración oficial Vitest 5](https://vitest.dev/guide/migration/).
