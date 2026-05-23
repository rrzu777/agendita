export function requireTestDatabase(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Integration tests must not run in production. Set NODE_ENV=test.',
    )
  }

  const url = process.env.DATABASE_URL ?? ''
  const isLocal = url.includes('localhost') || url.includes('127.0.0.1')
  const isTest = url.includes('test') || url.includes('test_db')

  if (!isLocal && !isTest) {
    throw new Error(
      `DATABASE_URL does not appear to be a test/local database: ${url.slice(0, 50)}... ` +
      'Set TEST_DATABASE_URL to a local Postgres before running integration tests.',
    )
  }
}
