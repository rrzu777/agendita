export function requireAnalyticsTestDatabase() {
  for (const key of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const raw = process.env[key]
    if (!raw) throw new Error(`${key} must be explicitly set for analytics tests`)
    const url = new URL(raw)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/agendita_owner_analytics_test' || process.env.NODE_ENV === 'production') throw new Error('Refusing non-exclusive analytics test database')
  }
}
