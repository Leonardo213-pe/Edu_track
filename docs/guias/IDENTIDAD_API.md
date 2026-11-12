# Identidad: endpoints de fase 2

Prefijo `/api/identity`. JWT Bearer en `Authorization`. Respuestas de identidad con datos sensibles se entregan `Cache-Control: no-store`. Fechas UTC ISO-8601. Un rol por cuenta; `UserProfile` contiene id, email, displayName, role, active, version, permissions, createdAt. Nunca contiene hash, contraseña o token de recuperación.

| Método / ruta | Entrada | Autorización / salida |
| --- | --- | --- |
| POST `/login` | email, password | Público; 200 con accessToken, expiresIn=900 y perfil; 5 intentos/min/IP |
| POST `/logout` | Sin datos obligatorios | Sesión activa; 204, revocación en servidor |
| GET `/me` | — | Sesión activa; perfil actual |
| PATCH `/me` | displayName, version | Sesión activa; no permite rol, correo o estado; devuelve perfil con nueva versión |
| POST `/users` | email, displayName, password, role | ADMIN; 201, cuenta activa; contraseña 12-128 caracteres |
| GET `/users` | limit=25, offset=0 | ADMIN; perfiles, máximo 100/página |
| PATCH `/users/:id` | email, displayName, role, active, version | ADMIN; UUID; 200, edición optimista y revocación si cambia acceso |
| POST `/password/change` | currentPassword, newPassword | Sesión activa; 204; verificar contraseña anterior y cerrar todas las sesiones |
| POST `/password/recovery` | email | Público; 202 genérico, encolado privado si existe cuenta activa; 3/min/IP y cooldown por cuenta |
| POST `/password/reset` | token, password | Público; 204; token opaco de 64 caracteres hex, vigente y sin usar; 5 intentos/min/IP |
| GET `/security-events` | limit=25, offset=0 | ADMIN; eventos paginados, sin credenciales; límites iguales a usuarios |

PATCH requiere todos los campos indicados. Los campos extra son rechazados. Conflictos de versión requieren recargar y revisar cambios; no reintentar automáticamente sobre datos ajenos. No se modifica el correo mediante perfil personal; solo ADMIN puede cambiarlo, invalidando acceso/recuperaciones anteriores.

| Código | HTTP | Interpretación |
| --- | --- | --- |
| INVALID_INPUT | 400 | Política de dominio; validación DTO usa también el 400 estándar de Nest |
| PASSWORD_MISMATCH | 400 | Contraseña actual errónea; sesión sigue válida |
| INVALID_RESET | 400 | Enlace inválido, usado, vencido o cuenta inactiva |
| INVALID_CREDENTIALS | 401 | Credenciales incorrectas, cuenta inactiva, JWT/sesión inválida/revocada/vencida |
| FORBIDDEN | 403 | Permiso insuficiente, incluso si se forja el rol al invocar el caso de uso |
| NOT_FOUND | 404 | Usuario objetivo inexistente para administración autenticada |
| EMAIL_EXISTS | 409 | Correo normalizado ya registrado |
| CONFLICT | 409 | Versión obsoleta o credenciales cambiadas mientras se procesaba la operación |
| LAST_ADMIN | 409 | Debe quedar al menos un ADMIN activo |
| Límite HTTP | 429 | Esperar ventana; respuesta estándar del limitador |

No hay endpoint de registro público, eliminación física, refresh, asignación de múltiples roles ni recuperación que permita consultar el token. El panel de administración utiliza estas rutas reales; las pantallas de curso se mantienen pendientes.
