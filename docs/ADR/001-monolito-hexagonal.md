# ADR-001: hexágonos por negocio y un backend

Estado: aceptado por la solicitud inicial. Contexto: dominio estable, equipo reducido, requisitos de pruebas/aislamiento. El PDF ADR-001 propone hexagonal y su ADR-002 dos despliegues; la solicitud actual exige uno.

Decisión: módulos con dominio, aplicación, infraestructura y contratos propios; Nest como composición/adaptador, un único ejecutable API. Planificadores y consumidores futuros dentro de ese backend. PostgreSQL compartido físicamente, propiedad lógica por módulo; comunicación por contratos/eventos públicos. Control AST de dependencias en CI.

Alternativas: capas técnicas globales, microservicios o API/Worker separados. Se descartan por acoplamiento global o contradicción con la solicitud.

Consecuencias: más puertos/mapeos, despliegue simple, sin escalado independiente de trabajos. Requiere límites de concurrencia, leases distribuidos y pruebas que impidan que tareas lentas perjudiquen exámenes. No afirmar que ejecutar todos los trabajos en el mismo proceso garantiza los SLO.
