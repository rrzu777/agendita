import { expect } from 'vitest'
import type { ActionResult } from '@/lib/actions/result'

/** Asierta que una action envuelta con action() falló con un mensaje que contiene `substring`. */
export async function expectActionError(promise: Promise<ActionResult<unknown>>, substring: string) {
  const res = await promise
  if (res.ok) throw new Error(`expected error result, got ok — substring esperado: "${substring}"`)
  expect(res.error).toContain(substring)
}

/** Desenvuelve un ActionResult: falla con un mensaje legible si la action
 *  wrappeada (action()) devolvió { ok: false } en un punto donde el test
 *  espera éxito (setup), en vez de un TypeError críptico sobre `.data`. */
export async function unwrap<T>(promise: Promise<ActionResult<T>>): Promise<T> {
  const res = await promise
  if (!res.ok) throw new Error(res.error)
  return res.data
}
