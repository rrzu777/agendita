import { describe, expect, it } from 'vitest'
import { getRootErrorContext } from '@/app/error'

describe('root error context', () => {
  it('preserves client context from route and tenant context from a known host', () => {
    expect(getRootErrorContext('/mi/mimos', 'agendita.cl')).toMatchObject({ kind: 'client', label: 'Mi cuenta' })
    expect(getRootErrorContext('/', 'mimos.agendita.cl')).toMatchObject({ kind: 'tenant', label: 'Tu reserva' })
    expect(getRootErrorContext('/login', 'agendita.cl')).toMatchObject({ kind: 'platform', label: 'Agendita' })
  })
})
