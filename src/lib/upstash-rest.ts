export interface UpstashCommandInput {
  restUrl: string
  restToken: string
  command: string
  args?: Array<string | number>
  signal?: AbortSignal
}

export type UpstashCommandFailureReason = 'http_status' | 'invalid_response'

export class UpstashCommandError extends Error {
  readonly reason: UpstashCommandFailureReason
  readonly status?: number

  constructor(reason: UpstashCommandFailureReason, status?: number) {
    super(
      reason === 'http_status'
        ? `Upstash Redis request failed with status ${status}`
        : 'Upstash Redis invalid response',
    )
    this.name = 'UpstashCommandError'
    this.reason = reason
    this.status = status
  }
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
    throw new UpstashCommandError('http_status', response.status)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new UpstashCommandError('invalid_response')
  }
  if (!isRecord(payload)) {
    throw new UpstashCommandError('invalid_response')
  }
  if ('error' in payload) {
    throw new UpstashCommandError('invalid_response')
  }
  if (!('result' in payload)) {
    throw new UpstashCommandError('invalid_response')
  }

  return payload.result
}
