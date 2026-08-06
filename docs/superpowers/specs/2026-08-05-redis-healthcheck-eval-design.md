# Redis health check con EVAL no mutante

**Fecha:** 2026-08-05  
**Estado:** diseño aprobado

## Contexto

El deploy productivo de `main` (`35c9aa5`) terminó correctamente y la portada responde `200`, pero `GET /api/health` devuelve `503` con Redis en `down`. El check actual hace un `GET` al root de `UPSTASH_REDIS_REST_URL` sin enviar un comando. Upstash REST requiere un comando en la URL o un `POST` cuyo body contenga el comando completo, por lo que el probe actual puede producir un falso negativo aunque Redis esté operativo.

## Decisión

El health check validará el mismo permiso que necesita el rate limiter productivo: ejecutar Lua mediante `EVAL`. Enviará `POST` al endpoint base normalizado de Upstash con:

- header `Authorization: Bearer <token>`;
- header `Content-Type: application/json`;
- body `["EVAL", "return 1", 0]` serializado como JSON;
- timeout existente de 3 segundos.

El script no lee ni escribe claves. Redis se considerará `up` únicamente cuando la respuesta HTTP sea exitosa y el JSON contenga `result: 1`. Esto evita que un token read-only o un ACL sin permiso de scripting produzca un health verde mientras el rate limiter falla cerrado.

La URL se normalizará eliminando un slash final, igual que `RedisRateLimiter`. Si faltan tanto URL como token, Redis seguirá como `not_configured`; si sólo existe una de las dos variables, quedará `down` sin hacer una petición incompleta. Cualquier error de red, timeout, HTTP no exitoso, JSON inválido o resultado inesperado conservará el estado `down` y el endpoint responderá `503`.

Los fallos registrarán server-side sólo una categoría segura (`partial_configuration`, `timeout_or_network`, `http_status` o `invalid_response`). No se incluirán URL, token ni body remoto.

## Alcance

- Modificar sólo `src/app/api/health/route.ts`.
- Agregar pruebas unitarias específicas para `EVAL` exitoso, HTTP no exitoso, JSON/resultado inválido, rechazo o timeout de `fetch` y configuración parcial URL/token.
- Aislar DB, Redis y Supabase en los tests; las aserciones de Redis identificarán la llamada por URL y comprobarán método, headers, body y normalización del endpoint.
- Mantener sin cambios el rate limiter, las variables de entorno, la base de datos y el esquema Prisma.
- No registrar URL ni token de Upstash.
- Eliminar en la ruta la variable muerta `allUp` y simplificar el cálculo redundante de `status`, sin cambiar su contrato.

## Validación

1. La prueba de regresión debe fallar con el `GET /` actual y demostrar que falta el contrato `EVAL`.
2. La implementación mínima debe dejar verdes las pruebas del health check y las suites de rate limiting/hardening.
3. El PR debe pasar lint, unit, integration, build y e2e.
4. Después del merge, el deployment de producción debe apuntar al SHA mergeado y `https://www.agendita.cl/api/health` debe responder `200` con DB, Redis y Supabase en `up`.
5. Como smoke funcional, un negocio público debe poder consultar disponibilidad —acción rate-limited y no mutante— sin recibir un bloqueo por rate limit. No se creará ni modificará ninguna reserva.

Si el probe corregido sigue marcando Redis `down`, la categoría segura del log orientará la revisión de credenciales, permisos ACL o disponibilidad de Upstash en Vercel.
