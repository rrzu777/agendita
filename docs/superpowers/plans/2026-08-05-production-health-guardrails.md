# Production Health Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detectar en un ciclo best-effort de aproximadamente 15 minutos credenciales rotas o dependencias externas degradadas sin exponer secretos ni cambiar el comportamiento funcional de reservas, pagos o rate limits.

**Architecture:** Un transporte REST pequeño concentra el contrato de Upstash y es compartido por el rate limiter y los probes. Un módulo de probes traduce respuestas externas a cuatro estados sanitizados; los Route Handlers público y autenticado sólo agregan esos estados y calculan HTTP 200/503. Un workflow independiente consulta ambos health checks y un runbook documenta la recuperación humana.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript, Vitest, Prisma, Upstash Redis REST, Resend REST, Mercado Pago REST, GitHub Actions.

> **Ajustes durante revisión:** el código de ejemplo posterior conserva el plan original como registro, pero la implementación final lo supera en cuatro puntos: DB reparte un presupuesto total de 3 segundos entre espera y transacción Prisma cancelable; Mercado Pago también es requerido en modo OAuth-only y exige el token global del webhook; Resend prueba una llave `sending_access` con un request inválido que no crea emails porque List Domains exigiría `full_access`; y el monitor prueba los endpoints público y profundo. El schedule de GitHub es best-effort, no un SLA menor a 15 minutos.

## Global Constraints

- Leer y respetar `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` antes de modificar Route Handlers.
- Cada request externo tiene timeout de `3_000` ms y `cache: 'no-store'`.
- El probe de Redis usa `EVAL` con el script sin escrituras `return 1`; sólo `1` significa `up`.
- En producción Redis, Supabase y Resend son requeridos; Mercado Pago es requerido explícitamente o por OAuth completo. Resend se valida sin ampliar `sending_access` ni crear emails.
- Los endpoints nunca devuelven URLs, tokens, cuerpos de error ni mensajes crudos de proveedores.
- El endpoint profundo reutiliza `CRON_SECRET` con `hasValidBearerSecret` y falla cerrado con HTTP 401.
- El workflow de salud es independiente de `.github/workflows/cron.yml` y no modifica ni serializa los crons existentes.
- No rotar credenciales, enviar emails, crear pagos ni escribir datos de producción desde este cambio.
- El endurecimiento de respuestas JSON con `errors > 0` en `Scheduled crons` queda para un PR separado.

---

### Task 1: Transporte REST compartido de Upstash y timeout del rate limiter

**Files:**
- Create: `src/lib/upstash-rest.ts`
- Create: `tests/unit/upstash-rest.test.ts`
- Modify: `src/lib/rate-limit.ts:205-298`
- Modify: `tests/unit/hardening.test.ts:227-276`

**Interfaces:**
- Produces: `executeUpstashCommand(input: UpstashCommandInput): Promise<unknown>`.
- `UpstashCommandInput` contiene `restUrl`, `restToken`, `command`, `args` y `signal` opcional.
- Consumed by: `RedisRateLimiter.check()` y `probeRedis()` de Task 2.

- [ ] **Step 1: Escribir pruebas fallidas del transporte**

Crear `tests/unit/upstash-rest.test.ts` con casos que observan el request real y la sanitización de errores:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeUpstashCommand } from '@/lib/upstash-rest'

describe('executeUpstashCommand', () => {
  afterEach(() => vi.restoreAllMocks())

  it('posts a flat command to the normalized REST URL', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: 'PONG' }), { status: 200 }),
    )

    await expect(executeUpstashCommand({
      restUrl: 'https://redis.example.com/',
      restToken: 'secret-token',
      command: 'EVAL',
      args: ['return redis.call("PING")', 0],
      signal,
    })).resolves.toBe('PONG')

    expect(fetchMock).toHaveBeenCalledWith('https://redis.example.com', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['EVAL', 'return redis.call("PING")', 0]),
      cache: 'no-store',
      signal,
    })
  })

  it.each([
    new Response('WRONGPASS leaked-provider-body', { status: 401 }),
    new Response(JSON.stringify({ error: 'WRONGPASS leaked-provider-body' }), { status: 200 }),
  ])('throws without leaking provider bodies', async response => {
    vi.spyOn(global, 'fetch').mockResolvedValue(response)
    const error = await executeUpstashCommand({
      restUrl: 'https://redis.example.com',
      restToken: 'secret-token',
      command: 'PING',
    }).catch(value => value)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).not.toContain('leaked-provider-body')
  })
})
```

- [ ] **Step 2: Ejecutar la prueba y confirmar rojo**

Run: `npm test -- tests/unit/upstash-rest.test.ts`

Expected: FAIL porque `@/lib/upstash-rest` todavía no existe.

- [ ] **Step 3: Implementar el transporte mínimo**

Crear `src/lib/upstash-rest.ts`:

```ts
export interface UpstashCommandInput {
  restUrl: string
  restToken: string
  command: string
  args?: Array<string | number>
  signal?: AbortSignal
}

export async function executeUpstashCommand({
  restUrl,
  restToken,
  command,
  args = [],
  signal,
}: UpstashCommandInput): Promise<unknown> {
  const response = await fetch(restUrl.replace(/\/$/, ''), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${restToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([command, ...args]),
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Upstash Redis request failed with status ${response.status}`)
  }

  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object' || 'error' in payload) {
    throw new Error('Upstash Redis command failed')
  }

  return 'result' in payload ? payload.result : undefined
}
```

- [ ] **Step 4: Ejecutar transporte y confirmar verde**

Run: `npm test -- tests/unit/upstash-rest.test.ts`

Expected: PASS.

- [ ] **Step 5: Agregar una prueba fallida del timeout en el rate limiter**

En `tests/unit/hardening.test.ts`, dentro de `describe('RedisRateLimiter')`, agregar:

```ts
it('bounds the Upstash request to three seconds', async () => {
  const controller = new AbortController()
  const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  fetchMock.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ result: [1, 9, 60] }),
  } as Response)

  const { RedisRateLimiter } = await import('@/lib/rate-limit')
  await new RedisRateLimiter('https://test.upstash.io', 'token')
    .check('create-booking', 10, 60_000, { ip: '1.2.3.4' })

  expect(timeoutSpy).toHaveBeenCalledWith(3_000)
  expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal)
})
```

- [ ] **Step 6: Ejecutar el caso y confirmar rojo**

Run: `npm test -- tests/unit/hardening.test.ts -t "bounds the Upstash request"`

Expected: FAIL porque `RedisRateLimiter` aún no crea ni pasa el signal.

- [ ] **Step 7: Refactorizar el rate limiter al transporte compartido**

En `src/lib/rate-limit.ts`, importar `executeUpstashCommand`, eliminar `redisCommand()` y reemplazar su uso por:

```ts
const result = await executeUpstashCommand({
  restUrl: this.restUrl,
  restToken: this.restToken,
  command: 'EVAL',
  args: [script, 1, key, maxRequests, windowSec],
  signal: AbortSignal.timeout(3_000),
}) as [number, number, number]
```

Mantener sin cambios el Lua de contador, el cálculo de `resetAt`, el log sanitizado y el retorno fail-closed.

- [ ] **Step 8: Ejecutar regresiones de transporte/rate limiting**

Run: `npm test -- tests/unit/upstash-rest.test.ts tests/unit/rate-limit.test.ts tests/unit/hardening.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit del transporte**

```bash
git add src/lib/upstash-rest.ts src/lib/rate-limit.ts tests/unit/upstash-rest.test.ts tests/unit/hardening.test.ts
git commit -m "fix: acotar transporte de rate limiting"
```

---

### Task 2: Probes sanitizados y health público correcto

**Files:**
- Create: `src/lib/health/dependencies.ts`
- Create: `tests/unit/health-dependencies.test.ts`
- Modify: `src/app/api/health/route.ts`
- Create: `tests/unit/health-route.test.ts`

**Interfaces:**
- Consumes: `executeUpstashCommand(input): Promise<unknown>` de Task 1.
- Produces: `DependencyStatus = 'up' | 'down' | 'not_configured' | 'not_required'`.
- Produces: `probeRedis()`, `probeSupabase()`, `probeResend()` y `probeMercadoPago()`, todos `Promise<DependencyStatus>`.
- Produces: `isDependencyReady(status: DependencyStatus, required: boolean): boolean`.
- Consumed by: `/api/health` y `/api/health/dependencies`.

- [ ] **Step 1: Escribir pruebas fallidas de los probes**

Crear `tests/unit/health-dependencies.test.ts` con `afterEach` que restaura mocks y envs, y estos escenarios observables:

```ts
it('marks Redis up only when no-write EVAL returns 1', async () => {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token')
  const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ result: 1 }), { status: 200 }),
  )

  await expect(probeRedis()).resolves.toBe('up')
  expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual([
    'EVAL',
    'return 1',
    0,
  ])
})

it.each(['NOPE', null])('marks unexpected Redis result %s down', async result => {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token')
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ result }), { status: 200 }),
  )
  await expect(probeRedis()).resolves.toBe('down')
})

it('validates the Resend list-domains contract', async () => {
  vi.stubEnv('RESEND_API_KEY', 'resend-token')
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 }),
  )
  await expect(probeResend()).resolves.toBe('up')
})

it('requires an identity payload from Mercado Pago when configured', async () => {
  vi.stubEnv('PAYMENT_PROVIDER', 'mercado_pago')
  vi.stubEnv('MERCADO_PAGO_ACCESS_TOKEN', 'mp-token')
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ id: 123 }), { status: 200 }),
  )
  await expect(probeMercadoPago()).resolves.toBe('up')
})

it('does not require Mercado Pago for manual payments', async () => {
  vi.stubEnv('PAYMENT_PROVIDER', 'manual')
  await expect(probeMercadoPago()).resolves.toBe('not_required')
})
```

Añadir exactamente estos bordes al mismo archivo:

    it('marks a partially configured dependency not_configured', async () => {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '')
      await expect(probeRedis()).resolves.toBe('not_configured')
    })

    it.each([
      ['Resend', probeResend, { RESEND_API_KEY: 'resend-token' }],
      ['Mercado Pago', probeMercadoPago, {
        PAYMENT_PROVIDER: 'mercado_pago',
        MERCADO_PAGO_ACCESS_TOKEN: 'mp-token',
      }],
    ])('marks %s down on HTTP rejection', async (_name, probe, env) => {
      Object.entries(env).forEach(([key, value]) => vi.stubEnv(key, value))
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('private-provider-detail', { status: 401 }),
      )
      await expect(probe()).resolves.toBe('down')
    })

    it('marks an invalid Resend JSON contract down', async () => {
      vi.stubEnv('RESEND_API_KEY', 'resend-token')
      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ object: 'list', data: null }), { status: 200 }),
      )
      await expect(probeResend()).resolves.toBe('down')
    })

    it('marks provider timeouts down instead of throwing', async () => {
      vi.stubEnv('RESEND_API_KEY', 'resend-token')
      vi.spyOn(global, 'fetch').mockRejectedValue(new DOMException('Timed out', 'AbortError'))
      await expect(probeResend()).resolves.toBe('down')
    })

- [ ] **Step 2: Ejecutar probes y confirmar rojo**

Run: `npm test -- tests/unit/health-dependencies.test.ts`

Expected: FAIL porque `@/lib/health/dependencies` no existe.

- [ ] **Step 3: Implementar probes mínimos**

Crear `src/lib/health/dependencies.ts` con este contrato:

```ts
import { executeUpstashCommand } from '@/lib/upstash-rest'

export type DependencyStatus = 'up' | 'down' | 'not_configured' | 'not_required'
export const DEPENDENCY_TIMEOUT_MS = 3_000

const timeoutSignal = () => AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function isDependencyReady(status: DependencyStatus, required: boolean): boolean {
  return status === 'up' || (!required && (status === 'not_configured' || status === 'not_required'))
}

export async function probeRedis(): Promise<DependencyStatus> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!restUrl || !restToken) return 'not_configured'

  try {
    const result = await executeUpstashCommand({
      restUrl,
      restToken,
      command: 'EVAL',
      args: ['return 1', 0],
      signal: timeoutSignal(),
    })
    return result === 1 ? 'up' : 'down'
  } catch {
    return 'down'
  }
}
```

En el mismo módulo, implementar exactamente los otros tres probes:

    export async function probeSupabase(): Promise<DependencyStatus> {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (!url || !key) return 'not_configured'

      try {
        const response = await fetch(url.replace(/\/$/, '') + '/rest/v1/?limit=1', {
          headers: { Authorization: 'Bearer ' + key, apikey: key },
          cache: 'no-store',
          signal: timeoutSignal(),
        })
        return response.ok ? 'up' : 'down'
      } catch {
        return 'down'
      }
    }

    export async function probeResend(): Promise<DependencyStatus> {
      const key = process.env.RESEND_API_KEY
      if (!key) return 'not_configured'

      try {
        const response = await fetch('https://api.resend.com/domains', {
          headers: { Authorization: 'Bearer ' + key },
          cache: 'no-store',
          signal: timeoutSignal(),
        })
        if (!response.ok) return 'down'
        const payload: unknown = await response.json()
        return isRecord(payload)
          && payload.object === 'list'
          && Array.isArray(payload.data)
          ? 'up'
          : 'down'
      } catch {
        return 'down'
      }
    }

    export async function probeMercadoPago(): Promise<DependencyStatus> {
      if (process.env.PAYMENT_PROVIDER !== 'mercado_pago') return 'not_required'
      const token = process.env.MERCADO_PAGO_ACCESS_TOKEN
      if (!token) return 'not_configured'

      try {
        const response = await fetch('https://api.mercadopago.com/users/me', {
          headers: { Authorization: 'Bearer ' + token },
          cache: 'no-store',
          signal: timeoutSignal(),
        })
        if (!response.ok) return 'down'
        const payload: unknown = await response.json()
        return isRecord(payload)
          && (typeof payload.id === 'string' || typeof payload.id === 'number')
          ? 'up'
          : 'down'
      } catch {
        return 'down'
      }
    }

- [ ] **Step 4: Ejecutar probes y confirmar verde**

Run: `npm test -- tests/unit/health-dependencies.test.ts`

Expected: PASS.

- [ ] **Step 5: Escribir pruebas fallidas del health público**

Crear `tests/unit/health-route.test.ts`. Mockear únicamente Prisma como frontera de DB, usar el transporte HTTP real con `fetch` mockeado por URL y llamar al Route Handler:

```ts
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: vi.fn() } }))

it('returns 200 when all production dependencies are operational', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'supabase-key')
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }])
  vi.spyOn(global, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.includes('redis.example.com')) {
      return new Response(JSON.stringify({ result: 1 }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  })

  const response = await GET()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    status: 'ok',
    checks: { db: 'up', redis: 'up', supabase: 'up' },
  })
})

it('keeps not_configured in detail but degrades required production dependencies', async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ '?column?': 1 }])
  const response = await GET()
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({
    status: 'degraded',
    checks: { db: 'up', redis: 'not_configured', supabase: 'not_configured' },
  })
})
```

Añadir los casos negativos y sus helpers con estas salidas exactas:

    function setProductionDependencyEnv() {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token')
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'supabase-key')
    }

    function mockHealthFetch(redisResult: unknown) {
      return vi.spyOn(global, 'fetch').mockImplementation(async input => {
        if (String(input).includes('redis.example.com')) {
          return new Response(JSON.stringify({ result: redisResult }), { status: 200 })
        }
        return new Response('{}', { status: 200 })
      })
    }

    it('degrades when EVAL does not return 1', async () => {
      setProductionDependencyEnv()
      vi.mocked(prisma.$queryRaw).mockResolvedValue([{ value: 1 }])
      mockHealthFetch('NOPE')
      const response = await GET()
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        status: 'degraded',
        checks: { db: 'up', redis: 'down', supabase: 'up' },
      })
    })

    it('degrades without serializing a database error', async () => {
      setProductionDependencyEnv()
      vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('private-db-detail'))
      mockHealthFetch(1)
      const response = await GET()
      const body = await response.text()
      expect(response.status).toBe(503)
      expect(body).toContain('"db":"down"')
      expect(body).not.toContain('private-db-detail')
    })

- [ ] **Step 6: Ejecutar el health público y confirmar rojo**

Run: `npm test -- tests/unit/health-route.test.ts`

Expected: al menos el caso de producción sin configuración FAIL porque hoy `not_configured` se acepta como sano y Redis no usa el probe EVAL compartido.

- [ ] **Step 7: Reescribir el agregador público**

Modificar `src/app/api/health/route.ts` para ejecutar DB, `probeRedis()` y `probeSupabase()` en paralelo. Calcular:

```ts
const required = process.env.NODE_ENV === 'production'
const healthy = checks.db === 'up'
  && isDependencyReady(checks.redis, required)
  && isDependencyReady(checks.supabase, required)
const status: HealthCheck['status'] = healthy ? 'ok' : 'degraded'
```

Conservar el shape público existente, `dynamic = 'force-dynamic'`, timestamp ISO y HTTP 200/503. El promise de DB debe capturar su error y producir `'down'`, sin cuerpo crudo.

- [ ] **Step 8: Ejecutar regresiones del health público**

Run: `npm test -- tests/unit/upstash-rest.test.ts tests/unit/health-dependencies.test.ts tests/unit/health-route.test.ts tests/unit/rate-limit.test.ts tests/unit/hardening.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit de probes y health público**

```bash
git add src/lib/health/dependencies.ts src/app/api/health/route.ts tests/unit/health-dependencies.test.ts tests/unit/health-route.test.ts
git commit -m "feat: endurecer health de dependencias"
```

---

### Task 3: Health profundo autenticado

**Files:**
- Create: `src/app/api/health/dependencies/route.ts`
- Create: `tests/unit/health-dependencies-route.test.ts`

**Interfaces:**
- Consumes: `probeRedis()`, `probeResend()`, `probeMercadoPago()` e `isDependencyReady()` de Task 2.
- Consumes: `hasValidBearerSecret(request, process.env.CRON_SECRET): boolean`.
- Produces: `GET(request: Request): Promise<NextResponse>`.
- Response autorizada: `{ status, checks: { redis, resend, mercadoPago }, timestamp }`.

- [ ] **Step 1: Escribir pruebas fallidas del Route Handler profundo**

Crear `tests/unit/health-dependencies-route.test.ts` con limpieza de env/mocks, estos helpers URL-aware y los casos de salida:

```ts
function setHealthyProductionEnv(options?: { paymentProvider?: string }) {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('CRON_SECRET', 'expected')
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.com')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token')
  vi.stubEnv('RESEND_API_KEY', 'resend-token')
  vi.stubEnv('PAYMENT_PROVIDER', options?.paymentProvider ?? 'mercado_pago')
  vi.stubEnv('MERCADO_PAGO_ACCESS_TOKEN', 'mp-token')
}

function mockProviders(options?: { resend?: Response }) {
  return vi.spyOn(global, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url.includes('redis.example.com')) {
      return new Response(JSON.stringify({ result: 1 }), { status: 200 })
    }
    if (url.includes('resend.com')) {
      return options?.resend
        ?? new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 })
    }
    if (url.includes('mercadopago.com')) {
      return new Response(JSON.stringify({ id: 123 }), { status: 200 })
    }
    throw new Error('Unexpected health URL: ' + url)
  })
}

const request = (secret?: string) => new Request(
  'http://localhost:3000/api/health/dependencies',
  { headers: secret ? { Authorization: `Bearer ${secret}` } : undefined },
)

it.each([undefined, 'wrong'])('fails closed before running probes', async secret => {
  vi.stubEnv('CRON_SECRET', 'expected')
  const fetchMock = vi.spyOn(global, 'fetch')
  const response = await GET(request(secret))
  expect(response.status).toBe(401)
  expect(await response.json()).toEqual({ error: 'Unauthorized' })
  expect(fetchMock).not.toHaveBeenCalled()
})

it('returns only sanitized states for healthy required dependencies', async () => {
  setHealthyProductionEnv()
  mockProviders()
  const response = await GET(request('expected'))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    status: 'ok',
    checks: { redis: 'up', resend: 'up', mercadoPago: 'up' },
  })
})

it('returns 503 without leaking a provider rejection body', async () => {
  setHealthyProductionEnv()
  mockProviders({ resend: new Response('invalid-key-private-detail', { status: 401 }) })
  const response = await GET(request('expected'))
  const body = await response.text()
  expect(response.status).toBe(503)
  expect(body).toContain('"resend":"down"')
  expect(body).not.toContain('invalid-key-private-detail')
})

it('marks Mercado Pago not_required for manual payments', async () => {
  setHealthyProductionEnv({ paymentProvider: 'manual' })
  mockProviders()
  const response = await GET(request('expected'))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    status: 'ok',
    checks: { mercadoPago: 'not_required' },
  })
})
```

Añadir exactamente los dos casos de configuración ausente:

    it.each([
      ['Resend', 'RESEND_API_KEY', 'resend'],
      ['Mercado Pago', 'MERCADO_PAGO_ACCESS_TOKEN', 'mercadoPago'],
    ])('degrades when required %s credentials are absent', async (_name, envKey, checkKey) => {
      setHealthyProductionEnv()
      vi.stubEnv(envKey, '')
      mockProviders()
      const response = await GET(request('expected'))
      expect(response.status).toBe(503)
      expect((await response.json()).checks[checkKey]).toBe('not_configured')
    })

- [ ] **Step 2: Ejecutar la prueba y confirmar rojo**

Run: `npm test -- tests/unit/health-dependencies-route.test.ts`

Expected: FAIL porque el Route Handler no existe.

- [ ] **Step 3: Implementar el Route Handler profundo**

Crear `src/app/api/health/dependencies/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'
import {
  isDependencyReady,
  probeMercadoPago,
  probeRedis,
  probeResend,
  type DependencyStatus,
} from '@/lib/health/dependencies'

export const dynamic = 'force-dynamic'

type DependencyHealthResponse = {
  status: 'ok' | 'degraded'
  checks: {
    redis: DependencyStatus
    resend: DependencyStatus
    mercadoPago: DependencyStatus
  }
  timestamp: string
}

export async function GET(request: Request) {
  if (!hasValidBearerSecret(request, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [redis, resend, mercadoPago] = await Promise.all([
    probeRedis(),
    probeResend(),
    probeMercadoPago(),
  ])
  const checks = { redis, resend, mercadoPago }
  const production = process.env.NODE_ENV === 'production'
  const healthy = isDependencyReady(redis, production)
    && isDependencyReady(resend, production)
    && isDependencyReady(mercadoPago, process.env.PAYMENT_PROVIDER === 'mercado_pago')
  const status: DependencyHealthResponse['status'] = healthy ? 'ok' : 'degraded'

  return NextResponse.json(
    { status, checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  )
}
```

- [ ] **Step 4: Ejecutar autenticación y agregación profunda**

Run: `npm test -- tests/unit/health-dependencies-route.test.ts tests/unit/bearer-secret.test.ts`

Expected: PASS.

- [ ] **Step 5: Ejecutar todos los tests focalizados de salud/rate limiting**

Run: `npm test -- tests/unit/upstash-rest.test.ts tests/unit/health-dependencies.test.ts tests/unit/health-route.test.ts tests/unit/health-dependencies-route.test.ts tests/unit/rate-limit.test.ts tests/unit/hardening.test.ts tests/unit/bearer-secret.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit del endpoint profundo**

```bash
git add src/app/api/health/dependencies/route.ts tests/unit/health-dependencies-route.test.ts
git commit -m "feat: agregar health profundo autenticado"
```

---

### Task 4: Monitor independiente y runbook operativo

**Files:**
- Create: `.github/workflows/production-health.yml`
- Create: `docs/production-incident-recovery.md`

**Interfaces:**
- Consumes: `GET /api/health/dependencies`, `vars.APP_BASE_URL` y `secrets.CRON_SECRET`.
- Produces: workflow `Production health`, programado cada 15 minutos y ejecutable manualmente.
- Produces: procedimiento seguro de contención, rotación y verificación post-incidente.

- [ ] **Step 1: Crear el workflow con tres intentos acotados**

Crear `.github/workflows/production-health.yml` con:

```yaml
name: Production health

on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch: {}

permissions:
  contents: read

concurrency:
  group: production-health
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    env:
      BASE_URL: ${{ vars.APP_BASE_URL || 'https://www.agendita.cl' }}
      CRON_SECRET: ${{ secrets.CRON_SECRET }}
    steps:
      - name: Check protected dependency health
        shell: bash
        run: |
          body_file="$(mktemp)"
          trap 'rm -f "$body_file"' EXIT

          for attempt in 1 2 3; do
            http_code="$(curl --silent --show-error \
              --output "$body_file" \
              --write-out '%{http_code}' \
              --max-time 15 \
              --header "Authorization: Bearer $CRON_SECRET" \
              "$BASE_URL/api/health/dependencies")" || http_code="000"

            if [[ "$http_code" == "200" ]] && jq --exit-status '.status == "ok"' "$body_file" >/dev/null; then
              jq . "$body_file"
              exit 0
            fi

            if [[ "$attempt" -lt 3 ]]; then
              sleep 10
            fi
          done

          echo "::error::Production health degraded (HTTP $http_code)"
          jq . "$body_file" || true
          exit 1
```

- [ ] **Step 2: Validar sintaxis del workflow**

Run: `ruby -e 'require "yaml"; YAML.parse_file(".github/workflows/production-health.yml")'`

Expected: exit 0 sin output.

Run: `git diff -- .github/workflows/cron.yml`

Expected: sin output; el monitor no toca el scheduler existente.

- [ ] **Step 3: Crear el runbook sin secretos**

Crear `docs/production-incident-recovery.md` con secciones y comandos completos:

1. Criterio de incidente: `/api/health` 503 o workflow `Production health` rojo.
2. Contención: pausar pagos online cambiando `PAYMENT_PROVIDER=manual` y redeployar cuando MP no sea confiable; no marcar cobros inciertos como pagados.
3. Upstash: rotar `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`, redeployar y exigir Redis `up` en ambos health checks.
4. Resend: rotar `RESEND_API_KEY`, confirmar dominio y enviar a una casilla QA controlada hasta estado `Delivered` o terminal explícito.
5. Mercado Pago: rotar `MERCADO_PAGO_ACCESS_TOKEN`, validar health, luego completar un pago sandbox + webhook + ledger con un negocio OAuth distinto del dueño de la app.
6. Smoke completo: reserva, disponibilidad, transferencia, reprogramación, crons, webhook e idempotencia.
7. Cierre: registrar deploy SHA, timestamps, resultados sanitizados y ejecutar manualmente el workflow.

Incluir estos comandos, que requieren variables locales ya cargadas y nunca imprimen secretos:

```bash
curl --fail --silent --show-error --max-time 15 "$BASE_URL/api/health" | jq

curl --fail --silent --show-error --max-time 15 \
  --header "Authorization: Bearer $CRON_SECRET" \
  "$BASE_URL/api/health/dependencies" | jq

gh workflow run production-health.yml
gh run list --workflow production-health.yml --limit 3
```

Explicar explícitamente que `up` en Resend sólo valida credencial/contrato, y `up` en MP sólo valida el token global; no sustituyen entrega de email ni un ciclo de pago/webhook.

- [ ] **Step 4: Revisar que no haya valores sensibles ni cambios de cron**

Run: `rg -n "(Bearer [A-Za-z0-9_-]{12,}|re_[A-Za-z0-9]|APP_USR-|WRONGPASS)" .github/workflows/production-health.yml docs/production-incident-recovery.md`

Expected: sin matches.

Run: `git diff --check`

Expected: sin output.

- [ ] **Step 5: Commit de operación**

```bash
git add .github/workflows/production-health.yml docs/production-incident-recovery.md
git commit -m "ops: monitorear salud de producción"
```

---

### Task 5: Verificación, revisión y entrega

**Files:**
- Verify: todos los archivos de Tasks 1-4.
- No crear archivos ni cambiar comportamiento durante esta tarea salvo correcciones detectadas por las verificaciones.

**Interfaces:**
- Consumes: todos los entregables anteriores.
- Produces: rama verificada, PR revisable y merge únicamente con el head exacto y checks verdes.

- [ ] **Step 1: Ejecutar suite focalizada fresca**

Run:

```bash
npm test -- tests/unit/upstash-rest.test.ts tests/unit/health-dependencies.test.ts tests/unit/health-route.test.ts tests/unit/health-dependencies-route.test.ts tests/unit/rate-limit.test.ts tests/unit/hardening.test.ts tests/unit/bearer-secret.test.ts
```

Expected: todos PASS, cero tests fallidos.

- [ ] **Step 2: Ejecutar validación estática y build**

Run: `npm run lint`

Expected: exit 0; documentar warnings existentes sin llamarlos errores nuevos.

Run: `npx tsc --noEmit --incremental false`

Expected: exit 0. Si aparecen errores baseline no relacionados, compararlos con `origin/main` antes de atribuirlos a esta rama.

Run: `npm run build`

Expected: exit 0 y Route Handlers compilados correctamente.

Run: `git diff --check && git status --short`

Expected: `git diff --check` exit 0 y sólo cambios intencionales/commits de este plan.

- [ ] **Step 3: Auto-revisión contra la especificación**

Confirmar manualmente:

- Redis health hace `EVAL` sin escritura y exige `1`.
- El rate limiter mantiene Lua/contadores/fail-closed y agrega timeout 3s.
- Todos los probes capturan errores y nunca incluyen cuerpos externos.
- Auth inválida no ejecuta probes y responde 401 uniforme.
- Producción degrada `not_configured`; MP manual queda `not_required`.
- El workflow tiene tres intentos, corre cada 15 minutos y no toca `cron.yml`.
- El runbook diferencia credencial sana de entrega/pago real.

- [ ] **Step 4: Publicar PR y revalidar el head exacto**

```bash
git push -u origin feature/production-health-guardrails
gh pr create --base main --head feature/production-health-guardrails \
  --title "feat: add production dependency health guardrails" \
  --body-file /tmp/agendita-production-health-pr.md
gh pr view --json number,url,headRefOid,mergeable,reviewDecision,statusCheckRollup
gh pr diff --check
gh pr checks --watch
```

El body debe resumir: causa operativa observada, alcance, pruebas, seguridad de datos, y que la rotación de credenciales + QA real siguen pendientes del operador. Guardar `headRefOid` y reconsultarlo justo antes de mergear.

- [ ] **Step 5: Merge sólo con estado estable**

Reconsultar PR, checks y threads. Si `headRefOid` no cambió, no hay threads bloqueantes y todos los checks requeridos están verdes:

```bash
gh pr merge --squash --delete-branch
git fetch origin main
gh pr view --json state,mergedAt,mergeCommit,url
```

Después del deploy, ejecutar manualmente `Production health`. Es correcto que quede rojo mientras las credenciales conocidas de Upstash, Resend o Mercado Pago sigan inválidas; el rojo será evidencia de que el guardrail detecta el incidente, no motivo para ocultarlo o relajar el endpoint.
