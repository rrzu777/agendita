import { assertSafeTestDatabaseUrl } from '../helpers/test-database-safety'

export function requireTestDatabase(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Integration tests must not run in production. Set NODE_ENV=test.',
    )
  }

  assertSafeTestDatabaseUrl(process.env.DATABASE_URL)
}
