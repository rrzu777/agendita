// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_ROOT = join(process.cwd(), 'src/app')
const LEDGER_PATH = join(
  process.cwd(),
  'docs/superpowers/audits/2026-09-13-route-redesign-coverage.md',
)

function pageRoutes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return pageRoutes(path)
    if (entry.name !== 'page.tsx') return []

    const route = relative(APP_ROOT, directory).split(sep).filter(Boolean).join('/')
    return [route ? `/${route}` : '/']
  })
}

describe('full redesign route ledger', () => {
  it('assigns every current page route to an implementation track', () => {
    const routes = pageRoutes(APP_ROOT).sort()
    const ledger = readFileSync(LEDGER_PATH, 'utf8')
    const documentedRoutes = [...ledger.matchAll(/^\|\s*\d+\s*\|\s*`([^`]+)`\s*\|/gm)]
      .map((match) => match[1])
      .sort()

    expect(routes).toHaveLength(53)
    expect(documentedRoutes).toEqual(routes)
  })
})
