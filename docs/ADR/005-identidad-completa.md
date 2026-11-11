# ADR-005: identidad, sesiones y recuperación

Estado: aceptado para fase 2. Amplía ADR-003, sin cambiar stack, hexágonos ni backend único.

## Decisión

Se conserva **registro administrativo**, sin registro público abierto, y un rol por usuario: Estudiante, Docente, Diseñador Instruccional y Administrador. Baja lógica mediante `active`; no borrado de cuentas o historial desde API. Usuarios existentes conservan credenciales/rol y migran activos, versión 0.

JWT HS256 15 minutos con `sub` y `jti`. Cada petición verifica firma, algoritmo, issuer, audience, expiración, sesión persistida, propietario y cuenta activa. Rol y permisos provienen del usuario actual, nunca de campos del cliente. Logout revoca la sesión en PostgreSQL; cambio de contraseña/recuperación revoca todas; cambio de correo/rol/estado también invalida sesiones y enlaces de recuperación. JWT anteriores sin `jti` quedan inválidos: iniciar sesión otra vez al actualizar.

Edición optimista con `version`, y mutaciones de identidad serializadas mediante advisory lock **transaccional exclusivo del módulo**. Releer actor/sesión dentro de cada operación evita usar permisos obsoletos; las derivaciones scrypt se realizan antes del lock. Se impide desactivar o degradar al último administrador activo incluso con peticiones simultáneas. Usuarios y evento se guardan en una transacción. CLI solo puede aprovisionar ADMIN si no existe ningún administrador activo; altas posteriores por API autenticada.

Permisos públicos `profile:read`, `profile:update`, `password:change`, `users:read`, `users:write`, `security:read`. `IdentityModule` exporta el token `IDENTITY_DIRECTORY` enlazado a un contrato puro `IdentityDirectory`; futuros consumidores importan solo `public/index.ts`. Permisos de curso/sección se añadirán en sus módulos, no se inventan ahora.

Recuperación: secreto opaco aleatorio de 256 bits, SHA-256 en tabla de tokens, vencimiento 15 minutos y uso único. Consumo, contraseña nueva, revocación de sesiones e invalidación de todos los enlaces son atómicos. Cooldown de 60 s por cuenta, límite HTTP de 3 solicitudes/min/IP y respuesta genérica para cuentas desconocidas/inactivas. No se responde con el token. Enlace mediante fragmento URL, borrado por la SPA al leerlo, con `no-referrer`.

El correo se encola dentro de la transacción; payload AES-256-GCM con IV aleatorio y clave derivada con separación de contexto del secreto JWT. No hay token legible en PostgreSQL. Un consumidor cada 2 s dentro del mismo backend reclama un mensaje con `FOR UPDATE SKIP LOCKED`; SMTP fuera del lock de usuarios. Reintenta hasta 5 intentos, backoff 5/10/20/40/80 s, registra fallo por intento y conserva trabajo fallido; solicitud nueva tras cooldown genera otro enlace. SMTP con timeout 5 s y TLS obligatorio si el host es remoto. Aceptación SMTP no demuestra llegada a la bandeja final. Entrega al menos una vez: una caída después de SMTP antes de commit puede duplicar correo, pero no el consumo del token.

Eventos de seguridad propios de identidad, sin contraseñas, correos ni tokens. Actor/cuenta por UUID y fecha UTC. La tabla rechaza UPDATE/DELETE mediante trigger; no se presenta como auditoría académica CAR-12 ni protección frente a un superusuario que deshabilite triggers. Consulta exclusiva ADMIN. No tocar el módulo `audit` para esta fase.

## Alternativas y consecuencias

JWT puramente stateless no permite salida/desactivación inmediata. Cookies HttpOnly con refresh rotativo son una alternativa válida para persistir sesiones entre recargas; se mantiene memoria de SPA para evitar ampliar el alcance a cookies/CSRF/refresh. Se añade una consulta de sesión por petición y almacenamiento operacional para recuperaciones/eventos.

El limitador HTTP sigue en memoria por instancia; antes de escalar necesita almacenamiento compartido y política de proxy confiable. Scrypt conserva aproximadamente 128 MiB por derivación. La serialización global dentro de identidad es adecuada para este módulo administrativo; no extenderla a exámenes. Retención de sesiones/eventos/trabajos, MFA/SSO y configuración de proveedor SMTP de producción requieren política operativa. Rotar `JWT_SECRET` invalida tokens JWT y mensajes cifrados pendientes; solicitar recuperación nueva tras rotación o vaciar la cola mediante procedimiento controlado.

Referencias: [OWASP recuperación](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [SMTP Nodemailer](https://nodemailer.com/smtp), [Mailpit](https://mailpit.axllent.org/docs/usage/sending-messages/).
