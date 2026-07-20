import { expect } from 'vitest'
import type { ActionResult } from '@/lib/actions/result'

/** Asierta que una action envuelta con action() falló con un mensaje que contiene `substring`. */
export async function expectActionError(promise: Promise<ActionResult<unknown>>, substring: string) {
  const res = await promise
  if (res.ok) throw new Error(`expected error result, got ok — substring esperado: "${substring}"`)
  expect(res.error).toContain(substring)
}
