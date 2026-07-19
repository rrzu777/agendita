import { describe, it, expect, vi } from 'vitest'
import { redirect, notFound } from 'next/navigation'

// El paquete `server-only` resuelve a un módulo que siempre throwea salvo
// bajo la condición de export "react-server" (que sólo el bundler de Next
// activa). Bajo Vitest (Node/jsdom) esa condición no existe, así que se
// mockea igual que cualquier otro módulo de infraestructura de Next
// (ver el patrón de `vi.mock('next/cache', ...)` en revalidate-business.test.ts).
vi.mock('server-only', () => ({}))

import { action, UserError } from './result'

describe('action() wrapper', () => {
  it('returns ok:true with data on success', async () => {
    const wrapped = action(async (n: number) => n * 2)
    await expect(wrapped(21)).resolves.toEqual({ ok: true, data: 42 })
  })

  it('maps UserError to ok:false with its message', async () => {
    const wrapped = action(async () => { throw new UserError('Saldo insuficiente') })
    await expect(wrapped()).resolves.toEqual({ ok: false, error: 'Saldo insuficiente' })
  })

  it('maps a generic Error to a generic message and logs it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapped = action(async () => { throw new TypeError('boom internal') })
    const res = await wrapped()
    expect(res).toEqual({ ok: false, error: 'Ocurrió un error inesperado. Intenta nuevamente.' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('maps a non-Error throw to the generic message without leaking it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapped = action(async () => { throw { message: 'secreto interno' } })
    const res = await wrapped()
    expect(res).toEqual({ ok: false, error: 'Ocurrió un error inesperado. Intenta nuevamente.' })
    spy.mockRestore()
  })

  it('re-throws Next redirect control-flow errors', async () => {
    const wrapped = action(async () => { redirect('/dashboard') })
    await expect(wrapped()).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
  })

  it('re-throws Next notFound control-flow errors', async () => {
    const wrapped = action(async () => { notFound() })
    await expect(wrapped()).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') })
  })

  it('preserves the wrapped function argument signature', async () => {
    const wrapped = action(async (a: string, b: number) => `${a}:${b}`)
    await expect(wrapped('x', 3)).resolves.toEqual({ ok: true, data: 'x:3' })
  })
})
