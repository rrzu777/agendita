import { execFileSync, spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { load: loadYaml } = require('js-yaml') as {
  load: (source: string) => unknown
}

const repositoryRoot = process.cwd()
const helperPath = resolve(repositoryRoot, 'scripts/run-json-cron.sh')
const requests: Array<{ path: string; method?: string; authorization?: string }> = []
let server: Server
let baseUrl: string

type WorkflowStep = { uses?: string; run?: string; env?: Record<string, string> }
type WorkflowJob = {
  env?: Record<string, string>
  'timeout-minutes'?: number
  steps: WorkflowStep[]
}
type Workflow = {
  on: { schedule: Array<{ cron: string }>; workflow_dispatch?: unknown }
  permissions?: { contents: string }
  concurrency?: { group: string; 'cancel-in-progress': boolean }
  jobs: Record<string, WorkflowJob>
}

function loadWorkflow(filename: string): Workflow {
  return loadYaml(
    readFileSync(resolve(repositoryRoot, '.github/workflows', filename), 'utf8'),
  ) as Workflow
}

function runnableSteps(workflow: Workflow): string[] {
  return Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .flatMap((step) => (step.run ? [step.run] : []))
}

function runSteps(workflow: Workflow): WorkflowStep[] {
  return Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .filter((step) => Boolean(step.run))
}

function resolveWorkflowUrl(run: string, baseUrl: string): string {
  return execFileSync(
    'bash',
    [
      '-c',
      `function scripts/run-json-cron.sh() { printf '%s\\n' "$1"; }\n${run}`,
    ],
    { encoding: 'utf8', env: { ...process.env, BASE_URL: baseUrl } },
  ).trim()
}

function executeHelper(path: string, secret = 'fixture-cron-secret') {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolveResult) => {
      const child = spawn(helperPath, [`${baseUrl}${path}`], {
        cwd: repositoryRoot,
        env: { ...process.env, CRON_SECRET: secret },
      })
      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.on('error', (error) => {
        resolveResult({ code: null, stdout, stderr: `${stderr}${error.message}` })
      })
      child.on('close', (code) => resolveResult({ code, stdout, stderr }))
    },
  )
}

beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push({
      path: request.url ?? '',
      method: request.method,
      authorization: request.headers.authorization,
    })

    response.setHeader('content-type', 'application/json')
    if (request.url === '/http-error') {
      response.statusCode = 503
      response.end(JSON.stringify({ errors: 0 }))
      return
    }

    const bodies: Record<string, string> = {
      '/ok': JSON.stringify({ sent: 2, skipped: 1, errors: 0 }),
      '/application-error': JSON.stringify({ sent: 1, errors: 1 }),
      '/string-errors': JSON.stringify({ errors: '0' }),
      '/missing-errors': JSON.stringify({ sent: 2 }),
      '/malformed': 'not-json',
    }
    response.end(bodies[request.url ?? ''] ?? JSON.stringify({ errors: 0 }))
  })

  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server unavailable')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
  })
})

describe('run-json-cron.sh', () => {
  it('posts the bearer secret and succeeds only for numeric errors equal to zero', async () => {
    const result = await executeHelper('/ok')

    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' })
    expect(requests.at(-1)).toEqual({
      path: '/ok',
      method: 'POST',
      authorization: 'Bearer fixture-cron-secret',
    })
  })

  it.each([
    '/application-error',
    '/string-errors',
    '/missing-errors',
    '/malformed',
    '/http-error',
  ])('fails for an invalid cron response at %s without leaking the secret', async (path) => {
    const secret = 'must-not-appear-in-output'
    const result = await executeHelper(path, secret)

    expect(result.code).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret)
  })
})

describe('cron workflow contract', () => {
  it('runs every hourly cron through the strict JSON helper', () => {
    const workflow = loadWorkflow('cron.yml')
    const jobs = Object.values(workflow.jobs)
    const runs = runnableSteps(workflow)

    expect(jobs).toHaveLength(1)
    expect(jobs[0].env?.BASE_URL).toBeTruthy()
    expect(jobs[0].env?.CRON_SECRET).toBeUndefined()
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(jobs[0]['timeout-minutes']).toBe(6)
    expect(jobs[0].steps.some((step) => step.uses === 'actions/checkout@v4')).toBe(true)
    expect(runSteps(workflow).every(
      (step) => step.env?.CRON_SECRET === '${{ secrets.CRON_SECRET }}',
    )).toBe(true)
    expect(runs).toHaveLength(4)
    expect(runs.every((run) => run.includes('scripts/run-json-cron.sh'))).toBe(true)
    expect(runs.join('\n')).not.toContain('curl ')
    for (const endpoint of [
      '/api/cron/expire-holds',
      '/api/cron/send-reminders',
      '/api/cron/transfer-reminders',
      '/api/cron/loyalty-automatic',
    ]) {
      expect(runs.filter((run) => run.includes(endpoint))).toHaveLength(1)
    }
  })

  it('runs only cancellation warnings every fifteen minutes with checkout and concurrency', () => {
    const workflow = loadWorkflow('cancellation-warnings.yml')
    const jobs = Object.values(workflow.jobs)
    const runs = runnableSteps(workflow)

    expect(workflow.on.schedule).toContainEqual({ cron: '*/15 * * * *' })
    expect(workflow.concurrency).toEqual({
      group: 'cancellation-warnings',
      'cancel-in-progress': false,
    })
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]['timeout-minutes']).toBe(3)
    expect(jobs[0].env?.CRON_SECRET).toBeUndefined()
    expect(jobs.flatMap((job) => job.steps).some((step) => step.uses === 'actions/checkout@v4')).toBe(true)
    expect(runSteps(workflow).every(
      (step) => step.env?.CRON_SECRET === '${{ secrets.CRON_SECRET }}',
    )).toBe(true)
    expect(jobs.some((job) => Boolean(job.env?.BASE_URL))).toBe(true)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toContain('scripts/run-json-cron.sh')
    expect(runs[0]).toContain('/api/cron/cancellation-warnings')
    expect(runs[0].match(/\/api\/cron\//g)).toHaveLength(1)
  })

  it.each(['https://cron.example.test', 'https://cron.example.test/'])(
    'normalizes BASE_URL=%s without corrupting the https origin',
    (baseUrl) => {
      for (const filename of ['cron.yml', 'cancellation-warnings.yml']) {
        for (const run of runnableSteps(loadWorkflow(filename))) {
          const resolvedUrl = resolveWorkflowUrl(run, baseUrl)

          expect(resolvedUrl).toMatch(/^https:\/\/cron\.example\.test\/api\/cron\//)
          expect(resolvedUrl).not.toContain('//api/')
        }
      }
    },
  )
})
