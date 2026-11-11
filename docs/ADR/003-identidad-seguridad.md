# ADR-003: primer incremento y seguridad de identidad

Estado: aceptado para el incremento inicial; políticas de institución pendientes. Contexto: cuatro roles CAR-13 y autorización como base de todos los casos de uso.

Decisión: implementar alta/listado por ADMIN, acceso, perfil, CLI privilegiada y asignación de un rol por usuario. Sin registro público. Email normalizado/único en BD. Scrypt nativo Node (N=2^17, r=8, p=1), sal aleatoria 16 bytes, derivación 64 bytes, comparación constante. Evita dependencia de binarios de hashing de terceros manteniendo el parámetro recomendado por [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Argon2id es alternativa futura preferida si se adopta un runtime/binario gestionado; los hashes están versionados por algoritmo/parámetros.

JWT HS256 firmado con secreto aleatorio externo, issuer/audience fijos, 15 minutos. Obtener rol de BD en cada petición; solo sub en token. Token en memoria del navegador, headers no-store, DTO estrictos, límite de acceso. Autorización en caso de uso, no solo guard.

Consecuencias: recargar requiere entrar de nuevo. El cierre de sesión local no revoca el token. Revocación, recuperación/cambio de contraseña, cambios de rol/bajas, MFA y limitador distribuido quedan pendientes. Un rol por usuario es una simplificación explícita. Scrypt usa aproximadamente 128 MiB por derivación; dimensionar concurrencia de login y cuotas por réplica antes de producción. No afirmar que identidad ya cumple todo CU-13.
