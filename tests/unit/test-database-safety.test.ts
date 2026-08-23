import { describe, expect, it } from 'vitest'
import { assertSafeTestDatabaseUrl } from '../helpers/test-database-safety'

const SAFE_URL = 'postgresql://postgres:test-only@127.0.0.1:55437/agendita_tours_test'

describe('test database safety', () => {
  it('allows the exact disposable local dashboard tours database URL', () => {
    expect(assertSafeTestDatabaseUrl(SAFE_URL).href).toBe(SAFE_URL)
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['non-PostgreSQL', 'https://postgres:test-only@127.0.0.1/agendita_tours_test'],
    ['remote', 'postgresql://postgres:test-only@db.example.com:5432/agendita_tours_test'],
    ['production database', 'postgresql://postgres:test-only@127.0.0.1:5432/agendita'],
    ['production-looking test database', 'postgresql://postgres:test-only@127.0.0.1:5432/agendita_production_test'],
    ['missing username', 'postgresql://:test-only@127.0.0.1:5432/agendita_tours_test'],
    ['missing password', 'postgresql://postgres@127.0.0.1:5432/agendita_tours_test'],
    ['query parameters', `${SAFE_URL}?schema=public`],
    ['fragment', `${SAFE_URL}#unsafe`],
  ])('rejects a %s URL', (_case, value) => {
    expect(() => assertSafeTestDatabaseUrl(value)).toThrow(/DATABASE_URL/)
  })
})
