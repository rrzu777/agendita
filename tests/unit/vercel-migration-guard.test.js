import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
const vercelConfig = JSON.parse(readFileSync(resolve('vercel.json'), 'utf8'))

describe('Vercel migration guard', () => {
  it('routes Vercel builds through the migration guard', () => {
    expect(packageJson.scripts['vercel-build']).toContain(
      'node scripts/run-vercel-migrations.mjs',
    )
    expect(packageJson.scripts['vercel-build']).not.toContain(
      'prisma migrate deploy',
    )
  })

  it('keeps automatic production deploys but disables unsafe branch previews', () => {
    expect(vercelConfig.git.deploymentEnabled).toEqual({
      '**': false,
      main: true,
    })
  })

  it('skips database migrations only for explicit preview deployments', async () => {
    const { shouldRunMigrations } = await import(
      '../../scripts/run-vercel-migrations.mjs'
    )

    expect(shouldRunMigrations({ VERCEL_ENV: 'preview' })).toBe(false)
    expect(shouldRunMigrations({ VERCEL_ENV: 'production' })).toBe(true)
    expect(shouldRunMigrations({ VERCEL_ENV: 'development' })).toBe(true)
    expect(shouldRunMigrations({})).toBe(true)
  })
})
