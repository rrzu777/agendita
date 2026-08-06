# Redis health check con PING

**Fecha:** 2026-08-05  
**Estado:** diseño aprobado

## Contexto

El deploy productivo de `main` (`35c9aa5`) terminó correctamente y la portada responde `200`, pero `GET /api/health` devuelve `503` con Redis en `down`. El check actual hace un `GET` al root de `UPSTASH_REDIS_REST_URL` sin enviar un comando. Upstash REST requiere un comando en la URL o un `POST` cuyo body contenga el comando completo, por lo que el probe actual puede producir un falso negativo aunque Redis esté operativo.

## Decisión

El health check enviará `POST` al endpoint base de Upstash con:

- header `Authorization: Bearer <token>`;
- header `Content-Type: application/json`;
- body `['PING']` serializado como JSON;
- timeout existente de 3 segundos.

Redis se considerará `up` únicamente cuando la respuesta HTTP sea exitosa y el JSON contenga `result: 'PONG'`. Cualquier error de red, timeout, HTTP no exitoso, JSON inválido o resultado inesperado conservará el estado `down` y el endpoint responderá `503`.

## Alcance

- Modificar sólo `src/app/api/health/route.ts`.
- Agregar pruebas unitarias específicas para `PING` exitoso y respuesta inválida.
- Mantener sin cambios el rate limiter, las variables de entorno, la base de datos y el esquema Prisma.
- No registrar URL ni token de Upstash.

## Validación

1. La prueba de regresión debe fallar con el `GET /` actual.
2. La implementación mínima debe dejar verdes las pruebas del health check y las suites de rate limiting/hardening.
3. El PR debe pasar lint, unit, integration, build y e2e.
4. Después del merge, el deployment de producción debe apuntar al SHA mergeado y `https://www.agendita.cl/api/health` debe responder `200` con DB, Redis y Supabase en `up`.

Si el probe corregido sigue marcando Redis `down`, el problema deja de ser el contrato HTTP del health check y pasa a requerir revisión de las credenciales o disponibilidad de Upstash en Vercel.
