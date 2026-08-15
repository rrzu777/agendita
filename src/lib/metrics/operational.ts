export type OperationalMetricSample = {
  operation: string
  outcome: 'success' | 'user_error' | 'error'
  count: number
  durationMs: number
}

type Counter = Omit<OperationalMetricSample, 'operation' | 'outcome'>

const startedAt = Date.now()
const counters = new Map<string, Counter>()
const operationName = /^[a-z][a-z0-9_]{0,63}$/

/**
 * Contadores por instancia para operaciones de servidor. No llevan negocio,
 * cliente, URL ni payload: el endpoint de Prometheus nunca necesita PII ni un
 * scan SQL para ser útil. En serverless los valores son deliberadamente
 * best-effort; el scrape muestra la salud de cada instancia caliente.
 */
export function recordOperationalMetric(
  operation: string,
  outcome: OperationalMetricSample['outcome'],
  durationMs: number,
): void {
  if (!operationName.test(operation) || !Number.isFinite(durationMs)) return
  const key = `${operation}:${outcome}`
  const current = counters.get(key) ?? { count: 0, durationMs: 0 }
  current.count += 1
  current.durationMs += Math.max(0, Math.round(durationMs))
  counters.set(key, current)
}

export function getOperationalMetricsSnapshot(): { startedAt: number; samples: OperationalMetricSample[] } {
  return {
    startedAt,
    samples: [...counters.entries()].map(([key, value]) => {
      const [operation, outcome] = key.split(':') as [string, OperationalMetricSample['outcome']]
      return { operation, outcome, ...value }
    }),
  }
}
