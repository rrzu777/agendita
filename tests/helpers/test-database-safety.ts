const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const TEST_DATABASE_NAME = /^agendita(?:_[a-z0-9]+)*_(?:e2e|test)$/
const PRODUCTION_NAME_PARTS = new Set(['live', 'prod', 'production'])

function unsafeDatabase(message: string): never {
  throw new Error(`Unsafe DATABASE_URL: ${message}`)
}

export function assertSafeTestDatabaseUrl(raw: string | undefined): URL {
  if (!raw) unsafeDatabase('a disposable PostgreSQL URL is required.')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    unsafeDatabase('the value is not a valid URL.')
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    unsafeDatabase('the URL must use PostgreSQL.')
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    unsafeDatabase('the host must be loopback-only.')
  }
  if (!url.username || !url.password) {
    unsafeDatabase('explicit test username and password are required.')
  }
  if (url.search || url.hash) {
    unsafeDatabase('query parameters and fragments are forbidden.')
  }

  const encodedName = url.pathname.slice(1)
  let databaseName: string
  try {
    databaseName = decodeURIComponent(encodedName)
  } catch {
    unsafeDatabase('the database name is not valid URL encoding.')
  }
  const nameParts = databaseName.split('_')
  if (
    !TEST_DATABASE_NAME.test(databaseName)
    || nameParts.some((part) => PRODUCTION_NAME_PARTS.has(part))
  ) {
    unsafeDatabase('the database name must be an explicit Agendita test/E2E database.')
  }

  return url
}
