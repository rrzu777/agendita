#!/usr/bin/env node

const REQUEST_TIMEOUT_MS = 15_000
const RETRY_DELAY_MS = 10_000
const INSTALL_MARKER = 'Instala Agendita'

function sleepFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { status: 'invalid_response' }
  }

  const sanitized = {}
  for (const key of ['status', 'checks', 'timestamp', 'error']) {
    if (payload[key] !== undefined) sanitized[key] = payload[key]
  }
  return sanitized
}

async function probe(url, options, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    let payload
    try {
      payload = sanitizePayload(await response.json())
    } catch {
      payload = { status: 'invalid_response' }
    }

    return {
      ok: response.ok && payload.status === 'ok',
      httpStatus: response.status,
      payload,
    }
  } catch {
    return {
      ok: false,
      httpStatus: 0,
      payload: { status: 'unreachable' },
    }
  }
}

function installerUrls(baseUrl) {
  const canonical = new URL('/instalar', `${baseUrl.replace(/\/$/, '')}/`)
  const tenant = new URL(canonical)
  tenant.hostname = `install-smoke.${canonical.hostname.replace(/^www\./, '')}`

  return {
    canonical: canonical.toString(),
    tenant: tenant.toString(),
  }
}

async function probeInstallPage(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const contentType = response.headers.get('content-type') ?? ''
    const body = await response.text()

    return {
      ok:
        response.ok &&
        contentType.toLowerCase().includes('text/html') &&
        body.includes(INSTALL_MARKER),
      httpStatus: response.status,
    }
  } catch {
    return { ok: false, httpStatus: 0 }
  }
}

async function probeTenantRedirect(url, canonicalUrl, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const location = response.headers.get('location')
    let target = ''
    try {
      target = location ? new URL(location, url).toString() : ''
    } catch {
      target = ''
    }

    return {
      ok: [307, 308].includes(response.status) && target === canonicalUrl,
      httpStatus: response.status,
    }
  } catch {
    return { ok: false, httpStatus: 0 }
  }
}

async function probeAnalyticsMonitor(url, cronSecret, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'Cache-Control': 'no-store',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    let payload
    try {
      const value = await response.json()
      payload = value && typeof value === 'object' && !Array.isArray(value)
        ? { state: typeof value.state === 'string' ? value.state : 'invalid_response' }
        : { state: 'invalid_response' }
    } catch {
      payload = { state: 'invalid_response' }
    }
    return {
      ok: response.ok && payload.state === 'healthy',
      httpStatus: response.status,
      state: payload.state,
    }
  } catch {
    return { ok: false, httpStatus: 0, state: 'unreachable' }
  }
}

async function checkProductionHealth({
  baseUrl,
  cronSecret,
  fetchImpl = fetch,
  sleep = sleepFor,
  attempts = 3,
  monitorExpected = false,
}) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  const installUrls = installerUrls(normalizedBaseUrl)
  let result

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const [publicHealth, dependencies, installPage, tenantRedirect, monitor] = await Promise.all([
      probe(`${normalizedBaseUrl}/api/health`, {}, fetchImpl),
      probe(
        `${normalizedBaseUrl}/api/health/dependencies`,
        { headers: { Authorization: `Bearer ${cronSecret}` } },
        fetchImpl,
      ),
      probeInstallPage(installUrls.canonical, fetchImpl),
      probeTenantRedirect(installUrls.tenant, installUrls.canonical, fetchImpl),
      monitorExpected
        ? probeAnalyticsMonitor(`${normalizedBaseUrl}/api/cron/owner-analytics-monitor`, cronSecret, fetchImpl)
        : Promise.resolve({ ok: true, skipped: true, httpStatus: 0 }),
    ])
    result = {
      ok: publicHealth.ok && dependencies.ok && installPage.ok && tenantRedirect.ok && monitor.ok,
      publicHealth,
      dependencies,
      installPage,
      tenantRedirect,
      monitor,
    }

    if (result.ok) return result
    if (attempt < attempts) await sleep(RETRY_DELAY_MS)
  }

  return result
}

async function main() {
  const baseUrl = process.env.BASE_URL
  const cronSecret = process.env.CRON_SECRET
  if (!baseUrl || !cronSecret) {
    console.error('Production health configuration is missing')
    process.exitCode = 1
    return
  }

  const result = await checkProductionHealth({
    baseUrl,
    cronSecret,
    monitorExpected: process.env.OWNER_ANALYTICS_MONITOR_EXPECTED === 'true',
  })
  const output = {
    publicHealth: result.publicHealth,
    dependencies: result.dependencies,
    installPage: result.installPage,
    tenantRedirect: result.tenantRedirect,
    monitor: result.monitor,
  }

  if (result.ok) {
    console.log(JSON.stringify(output, null, 2))
    return
  }

  console.error('::error::Production health degraded')
  console.error(JSON.stringify(output, null, 2))
  process.exitCode = 1
}

if (require.main === module) {
  main().catch(() => {
    console.error('::error::Production health monitor failed')
    process.exitCode = 1
  })
}

module.exports = { checkProductionHealth }
