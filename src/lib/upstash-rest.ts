export interface UpstashCommandInput {
  restUrl: string
  restToken: string
  command: string
  args?: Array<string | number>
  signal?: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Executes one Upstash REST command using the flat-array protocol.
 *
 * Errors intentionally omit provider bodies: those can contain operational
 * details that must not reach health responses or application logs.
 */
export async function executeUpstashCommand({
  restUrl,
  restToken,
  command,
  args = [],
  signal,
}: UpstashCommandInput): Promise<unknown> {
  const response = await fetch(restUrl.replace(/\/$/, ''), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${restToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([command, ...args]),
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Upstash Redis request failed with status ${response.status}`)
  }

  const payload: unknown = await response.json()
  if (!isRecord(payload)) {
    throw new Error('Upstash Redis invalid response')
  }
  if ('error' in payload) {
    throw new Error('Upstash Redis command failed')
  }
  if (!('result' in payload)) {
    throw new Error('Upstash Redis invalid response')
  }

  return payload.result
}
