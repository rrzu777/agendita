#!/usr/bin/env node

const REQUEST_TIMEOUT_MS = 15_000
const RETRY_DELAY_MS = 10_000

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

async function checkProductionHealth({
  baseUrl,
  cronSecret,
  fetchImpl = fetch,
  sleep = sleepFor,
  attempts = 3,
}) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  let result

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const [publicHealth, dependencies] = await Promise.all([
      probe(`${normalizedBaseUrl}/api/health`, {}, fetchImpl),
      probe(
        `${normalizedBaseUrl}/api/health/dependencies`,
        { headers: { Authorization: `Bearer ${cronSecret}` } },
        fetchImpl,
      ),
    ])
    result = {
      ok: publicHealth.ok && dependencies.ok,
      publicHealth,
      dependencies,
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
