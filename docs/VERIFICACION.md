# Verificación de la primera entrega

Sesión local del 10 al 11 de noviembre de 2026, America/Lima. Entorno Windows/PowerShell, Node 24.22.2 portátil con SHA-256 cotejado contra el manifiesto oficial de nodejs.org, npm 11.19.1, Docker Engine 29.8.2 y Compose 5.6.0. No se modificó la instalación global de Node ni el PostgreSQL existente en 5432.

## Resultados ejecutados

| Comando / prueba | Resultado observado |
| --- | --- |
| `npm install` con manifiestos finales | Dependencias/lockfile actualizados, **0 vulnerabilidades** reportadas por npm audit en esa ejecución |
| `npm run generate` | Prisma 7.10.1 genera cliente aislado en adaptador identity |
| `npm run typecheck` | Backend y frontend sin errores TypeScript |
| `npm run build` | Backend compilado y SPA Vite 7.3.8 generada |
| `npm run check` | Completo, código de salida 0: generación, tipos, build y suites |
| Unitarias backend con Vitest 5.1.0 | **26/26**: invariantes, casos de uso/permisos, scrypt real y JWT real |
| Cobertura del núcleo implementado | **100%** líneas (37/37), ramas (38/38), funciones (13/13), statements (52/52); tres archivos con comportamiento, un archivo de interfaces omitido por vacío |
| Frontend con Vitest/Testing Library | **2/2**: acceso/perfil/cierre y rechazo de credenciales; fetch es un doble de prueba explícito |
| `npm run test:architecture` | **4/4**: imports, ejemplos prohibidos, hexágonos por módulo y grafo previsto sin ciclos |
| `npm run db:migrate` en DB de pruebas | Migración aplicada realmente en PostgreSQL 17 aislado, base `edutrack_test`, puerto 55432 |
| `npm run test:integration` | **7/7** contra Nest compilado, Prisma y PostgreSQL reales, sin repositorio en memoria |
| Construcción y arranque Compose | Imágenes construidas con `npm ci`; API aplica migración y arranca; db/api/web saludables |
| `npm run test:smoke` | SPA HTTP 200, readiness, CLI real, login, perfil seguro, alta/listado y rechazo 403 a estudiante mediante Nginx/API/DB reales; cuentas propias eliminadas |
| Estado Git | Rama `feat/initial-foundation`, sin commits/merge/push automáticos |

Integración verifica perfil sin hash, JWT manipulado/ausente, cuatro roles, rechazo de administración a los tres roles no ADMIN, DTO estricto, paginación, unicidad bajo dos altas simultáneas, rol actualizado desde persistencia y rate limiting. No usa proveedores externos ni presenta respuestas simuladas como una integración.

## Incidencias detectadas y resueltas

- El sandbox bloqueaba el acceso de esbuild al resolver rutas y la comunicación con Docker; las verificaciones se ejecutaron con acceso autorizado fuera de esa restricción.
- Puerto 5432 ocupado: solo el `.env` local de EduTrack pasó a 5433; el otro servicio no se detuvo.
- Primera ejecución de Prisma compilado falló por imports `.ts`: se configuró extensión `.js`, se regeneró y se repitieron integración y arranque.
- Debian slim no incluía OpenSSL: añadido a la imagen API, reconstruida y arrancada.
- Primera prueba de arquitectura clasificó la configuración técnica de raíz como módulo ajeno: corregida para distinguir otros módulos de configuración; los ejemplos de imports privados prohibidos siguen fallando como se espera.
- Vitest 3 evaluado inicialmente tenía avisos de seguridad: sustituido por 5.1.0, ajustadas aserciones frontend y repetidos tipos/build/pruebas con el lockfile final.

## Límites de la evidencia

No se ejecutó CI en GitHub: se añadió el workflow y sus comandos se comprobaron localmente; su primera ejecución remota queda pendiente. No se ejecutó matriz real de navegadores ni revisión visual automatizada de todas las pantallas. La SPA se compiló, se probó con DOM simulado y se sirvió realmente vía Nginx.

La cobertura corresponde únicamente al código existente de dominio/aplicación de identidad, no a todo el LMS ni al frontend/adaptadores. No hay pruebas de carga ejecutadas, certificación de 3.000 concurrentes, alta disponibilidad, TLS producción, Redis/SQS/S3, proveedores de plagio, legado SOAP/REST o despliegue a nube. Exámenes, notas y auditoría inmutable son diseño pendiente. El informe fuente conserva sus supuestos, no se convierten en resultados.

Los servicios de desarrollo quedan accesibles en web `localhost:8080`, API `localhost:3000`, PostgreSQL `localhost:5433`. `.env` contiene secretos locales aleatorios y está ignorado por Git. No queda una cuenta predeterminada; para entrar crear el primer administrador siguiendo README. Base de integración temporal detenida después de la verificación.
