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

async function checkProductionHealth({
  baseUrl,
  cronSecret,
  fetchImpl = fetch,
  sleep = sleepFor,
  attempts = 3,
}) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  const installUrls = installerUrls(normalizedBaseUrl)
  let result

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const [publicHealth, dependencies, installPage, tenantRedirect] = await Promise.all([
      probe(`${normalizedBaseUrl}/api/health`, {}, fetchImpl),
      probe(
        `${normalizedBaseUrl}/api/health/dependencies`,
        { headers: { Authorization: `Bearer ${cronSecret}` } },
        fetchImpl,
      ),
      probeInstallPage(installUrls.canonical, fetchImpl),
      probeTenantRedirect(installUrls.tenant, installUrls.canonical, fetchImpl),
    ])
    result = {
      ok: publicHealth.ok && dependencies.ok && installPage.ok && tenantRedirect.ok,
      publicHealth,
      dependencies,
      installPage,
      tenantRedirect,
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

  const result = await checkProductionHealth({ baseUrl, cronSecret })
  const output = {
    publicHealth: result.publicHealth,
    dependencies: result.dependencies,
    installPage: result.installPage,
    tenantRedirect: result.tenantRedirect,
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
