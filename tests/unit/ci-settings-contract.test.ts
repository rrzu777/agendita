import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')

function job(name: string, nextName: string) {
  const start = workflow.indexOf(`  ${name}:`)
  const end = nextName ? workflow.indexOf(`  ${nextName}:`, start + 1) : workflow.length
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return workflow.slice(start, end)
}

describe('CI settings contracts', () => {
  it('builds and runs Settings E2E with an explicit sandbox payment environment', () => {
    expect(job('build', 'e2e')).toContain("MERCADO_PAGO_ENVIRONMENT: 'sandbox'")
    expect(job('e2e', '')).toContain("MERCADO_PAGO_ENVIRONMENT: 'sandbox'")
  })

  it('runs the complete unit suite serially to avoid worker-pressure flakes', () => {
    const unit = job('unit', 'integration')

    expect(unit).toContain('npm run test:unit -- --maxWorkers=1 --no-file-parallelism')
    expect(unit).not.toContain('--exclude')
  })
})
