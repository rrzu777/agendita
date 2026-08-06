import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  executeUpstashCommand,
  UpstashCommandError,
} from '@/lib/upstash-rest'

describe('executeUpstashCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts a flat command to the normalized REST URL', async () => {
    const signal = new AbortController().signal
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ result: 'PONG' }), { status: 200 }),
    )

    await expect(executeUpstashCommand({
      restUrl: 'https://redis.example.com/',
      restToken: 'secret-token',
      command: 'EVAL',
      args: ['return redis.call("PING")', 0],
      signal,
    })).resolves.toBe('PONG')

    expect(fetchMock).toHaveBeenCalledWith('https://redis.example.com', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['EVAL', 'return redis.call("PING")', 0]),
      cache: 'no-store',
      signal,
    })
  })

  it('rejects HTTP failures without leaking the provider body', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('WRONGPASS leaked-provider-body', { status: 401 }),
    )

    const error = await executeUpstashCommand({
      restUrl: 'https://redis.example.com',
      restToken: 'secret-token',
      command: 'PING',
    }).catch(value => value)

    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) {
      throw new TypeError('Expected executeUpstashCommand to reject with Error')
    }
    expect(error).toBeInstanceOf(UpstashCommandError)
    expect(error).toMatchObject({ reason: 'http_status', status: 401 })
    expect(error.message).toContain('status 401')
    expect(error.message).not.toContain('leaked-provider-body')
  })

  it('rejects command errors without leaking the provider payload', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'WRONGPASS leaked-provider-body' }),
        { status: 200 },
      ),
    )

    const error = await executeUpstashCommand({
      restUrl: 'https://redis.example.com',
      restToken: 'secret-token',
      command: 'PING',
    }).catch(value => value)

    expect(error).toBeInstanceOf(Error)
    if (!(error instanceof Error)) {
      throw new TypeError('Expected executeUpstashCommand to reject with Error')
    }
    expect(error).toBeInstanceOf(UpstashCommandError)
    expect(error).toMatchObject({ reason: 'invalid_response' })
    expect(error.message).not.toContain('leaked-provider-body')
  })

  it('rejects an invalid JSON envelope', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(null), { status: 200 }),
    )

    await expect(executeUpstashCommand({
      restUrl: 'https://redis.example.com',
      restToken: 'secret-token',
      command: 'PING',
    })).rejects.toThrow('invalid response')
  })
})
