# Redis Health Check EVAL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el falso probe `GET /` de Redis por un `EVAL` no mutante que pruebe el mismo permiso requerido por el rate limiter y confirmar el contrato en producción.

**Architecture:** El Route Handler conserva su respuesta pública actual y ejecuta directamente un comando REST `EVAL "return 1" 0` contra Upstash. Los tests mockean DB y clasifican cada `fetch` por URL para aislar Redis de Supabase; los fallos sólo emiten categorías sanitizadas server-side.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript, Vitest 4, Upstash Redis REST, GitHub Actions y Vercel.

## Global Constraints

- No modificar `src/lib/rate-limit.ts`, variables de entorno, Prisma ni datos.
- El probe Redis no puede leer ni escribir claves.
- Nunca registrar URL, token, authorization header ni body remoto.
- `not_configured` aplica únicamente cuando faltan URL y token; una configuración parcial devuelve `down` sin hacer `fetch`.
- La validación productiva de disponibilidad es read-only y no crea ni modifica reservas.

---

### Task 1: Probar y corregir el Route Handler de health

**Files:**
- Create: `tests/unit/health-route.test.ts`
- Modify: `src/app/api/health/route.ts:16-74`

**Interfaces:**
- Consumes: `prisma.$queryRaw`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL` y credenciales Supabase existentes.
- Produces: `GET(): Promise<NextResponse<HealthCheck>>`, sin cambios en el JSON público; el probe Redis usa `POST` con `JSON.stringify(['EVAL', 'return 1', 0])`.

- [ ] **Step 1: Crear el test RED del contrato EVAL exitoso**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRawMock } = vi.hoisted(() => ({ queryRawMock: vi.fn() }))

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: queryRawMock },
}))

import { GET } from '@/app/api/health/route'

const fetchMock = vi.fn()
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  queryRawMock.mockReset().mockResolvedValue([{ ok: 1 }])
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://test.upstash.io/')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it('probes Redis with a non-mutating EVAL command', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ result: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  )
  vi.stubGlobal('fetch', fetchMock)

  const response = await GET()

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    status: 'ok',
    checks: { db: 'up', redis: 'up', supabase: 'not_configured' },
  })
  expect(fetchMock).toHaveBeenCalledWith(
    'https://test.upstash.io',
    expect.objectContaining({
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['EVAL', 'return 1', 0]),
    })
  )
})
```

- [ ] **Step 2: Ejecutar el test y comprobar el RED correcto**

Run: `npm run test:unit -- tests/unit/health-route.test.ts`

Expected: FAIL porque la implementación viva usa `GET https://test.upstash.io//` y no envía método/body EVAL.

- [ ] **Step 3: Completar la matriz de regresión antes de producción**

Agregar casos que:

```ts
it.each([
  {
    label: 'unexpected result',
    redisResponse: new Response(JSON.stringify({ result: 'PONG' }), { status: 200 }),
    expectedLog: { reason: 'invalid_response' },
  },
  {
    label: 'invalid JSON',
    redisResponse: new Response('not-json', { status: 200 }),
    expectedLog: { reason: 'invalid_response' },
  },
  {
    label: 'unauthorized',
    redisResponse: new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    expectedLog: { reason: 'http_status', status: 401 },
  },
])('marks Redis down for $label', async ({ redisResponse, expectedLog }) => {
  fetchMock.mockResolvedValue(redisResponse)

  const response = await GET()
  const payload = await response.json()

  expect(response.status).toBe(503)
  expect(payload.checks.redis).toBe('down')
  expect(errorSpy).toHaveBeenCalledWith('[Health] Redis check failed', expectedLog)
  expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('test-token')
  expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('test.upstash.io')
})

it('marks partial Redis configuration down without fetching', async () => {
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')

  const response = await GET()

  expect(response.status).toBe(503)
  expect((await response.json()).checks.redis).toBe('down')
  expect(fetchMock).not.toHaveBeenCalled()
  expect(errorSpy).toHaveBeenCalledWith('[Health] Redis check failed', {
    reason: 'partial_configuration',
  })
})

it('marks Redis down when fetch rejects', async () => {
  fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'))

  const response = await GET()

  expect(response.status).toBe(503)
  expect((await response.json()).checks.redis).toBe('down')
  expect(errorSpy).toHaveBeenCalledWith('[Health] Redis check failed', {
    reason: 'timeout_or_network',
  })
})

it('keeps Redis not configured when URL and token are absent', async () => {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')

  const response = await GET()

  expect(response.status).toBe(200)
  expect((await response.json()).checks.redis).toBe('not_configured')
  expect(fetchMock).not.toHaveBeenCalled()
  expect(errorSpy).not.toHaveBeenCalled()
})
```

Cada caso debe restaurar `fetch`, env y spies. Las aserciones de logs sólo aceptan `{ reason }` y, para HTTP, `{ reason, status }`; serializar los argumentos no debe contener `test-token` ni `test.upstash.io`.

- [ ] **Step 4: Implementar el probe mínimo**

```ts
const redisUrl = process.env.UPSTASH_REDIS_REST_URL
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN

if (redisUrl || redisToken) {
  if (!redisUrl || !redisToken) {
    checks.redis = 'down'
    console.error('[Health] Redis check failed', { reason: 'partial_configuration' })
  } else {
    try {
      const response = await fetch(redisUrl.replace(/\/$/, ''), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redisToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['EVAL', 'return 1', 0]),
        signal: AbortSignal.timeout(3000),
      })

      if (!response.ok) {
        checks.redis = 'down'
        console.error('[Health] Redis check failed', {
          reason: 'http_status',
          status: response.status,
        })
      } else {
        const payload: unknown = await response.json()
        checks.redis =
          typeof payload === 'object' && payload !== null &&
          'result' in payload && payload.result === 1
            ? 'up'
            : 'down'
        if (checks.redis === 'down') {
          console.error('[Health] Redis check failed', { reason: 'invalid_response' })
        }
      }
    } catch (error) {
      checks.redis = 'down'
      const reason = error instanceof SyntaxError
        ? 'invalid_response'
        : 'timeout_or_network'
      console.error('[Health] Redis check failed', { reason })
    }
  }
}
```

Eliminar `allUp` y reemplazar el ternario redundante por una condición única que produzca `ok` cuando DB y dependencias configuradas estén arriba; en cualquier otro caso, `degraded`.

- [ ] **Step 5: Ejecutar la verificación GREEN focalizada**

Run: `npm run test:unit -- tests/unit/health-route.test.ts tests/unit/rate-limit.test.ts tests/unit/hardening.test.ts tests/unit/env-validation.test.ts`

Expected: todos los archivos y tests pasan; no aparecen URLs ni tokens reales en la salida.

- [ ] **Step 6: Ejecutar checks estáticos y revisar el diff**

Run: `npm run lint`

Expected: 0 errores; warnings preexistentes pueden permanecer fuera del diff.

Run: `git diff --check`

Expected: exit 0.

Run: `git diff -- src/app/api/health/route.ts tests/unit/health-route.test.ts`

Expected: sólo probe EVAL, clasificación segura, simplificación de status y tests relacionados.

- [ ] **Step 7: Commit de implementación**

```bash
git add src/app/api/health/route.ts tests/unit/health-route.test.ts
git commit -m "fix: validar Redis con el contrato del rate limiter"
```

---

### Task 2: Publicar, revisar y validar producción

**Files:**
- Modify: `docs/superpowers/plans/2026-08-05-redis-healthcheck-eval.md` únicamente para marcar pasos completados si se decide persistir tracking.

**Interfaces:**
- Consumes: branch `feature/healthcheck-redis-ping`, CI del PR, GitHub Deployments y `https://www.agendita.cl`.
- Produces: PR mergeado en `main`, deployment productivo del SHA mergeado y evidencia de health + disponibilidad read-only.

- [ ] **Step 1: Rebasar sólo si `origin/main` avanzó y revalidar**

Run: `git fetch origin main --prune`

Run: `git merge-base --is-ancestor origin/main HEAD`

Expected: exit 0. Si falla, rebasear sobre `origin/main` y repetir la suite focalizada y lint antes de publicar.

- [ ] **Step 2: Push y PR**

```bash
git push -u origin feature/healthcheck-redis-ping
gh pr create --base main --head feature/healthcheck-redis-ping \
  --title "fix: validar Redis con el contrato del rate limiter" \
  --body-file /tmp/agendita-redis-health-pr.md
```

El body debe incluir la reproducción productiva `503 redis=down`, el cambio a `EVAL return 1`, la matriz RED/GREEN, lint y el límite de no tocar configuración/datos.

- [ ] **Step 3: Revisar el head vivo y esperar checks**

Run: `gh pr view --json headRefOid,state,mergeStateStatus,statusCheckRollup,url`

Run: `gh pr diff --check` si la versión instalada de `gh` lo soporta; si no, usar `git diff origin/main...HEAD --check`.

Run: `gh pr checks --watch`

Expected: lint, unit, integration, build, e2e y Vercel completan en verde sobre el SHA vivo.

- [ ] **Step 4: Merge squash y verificar `main`**

Run: `gh pr merge --squash`

Después del merge ejecutar:

```bash
MERGE_SHA=$(gh pr view --json mergeCommit --jq '.mergeCommit.oid')
git fetch origin main
test "$(git rev-parse origin/main)" = "$MERGE_SHA"
RUN_ID=$(gh run list --branch main --commit "$MERGE_SHA" --workflow CI --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
```

- [ ] **Step 5: Confirmar deployment y health productivo**

Run: `gh api repos/rrzu777/agendita/deployments --jq '.[] | select(.environment == "Production") | [.id,.sha,.statuses_url] | @tsv' | head -n 1`

Consultar el `statuses_url` y exigir `state=success` con el SHA mergeado.

Run: `curl -sS -i https://www.agendita.cl/api/health`

Expected: HTTP 200 y JSON con `status=ok`, `db=up`, `redis=up`, `supabase=up`.

- [ ] **Step 6: Smoke read-only del rate limiter real**

Abrir un negocio público en el navegador, iniciar el flujo de reserva hasta consultar horarios disponibles y detenerse antes de confirmar. Expected: aparecen horarios o el estado normal de ausencia de disponibilidad; no aparece error de rate limit y no se crea ninguna reserva.

- [ ] **Step 7: Cierre**

Confirmar checkout principal limpio y sincronizado con `origin/main`. Reportar PR, merge SHA, CI post-merge, deployment SHA, health JSON sanitizado y resultado del smoke. Preservar el worktree hasta terminar la validación productiva.
