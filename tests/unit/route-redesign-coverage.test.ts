// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_ROOT = join(process.cwd(), 'src/app')
const LEDGER_PATH = join(
  process.cwd(),
  'docs/superpowers/audits/2026-09-13-route-redesign-coverage.md',
)

const TRACK_FIVE_SHELLS: Record<string, string> = {
  '/mi': 'ClientAccountShell',
  '/mi/[slug]': 'ClientBusinessShell',
  '/mi/[slug]/reservas/[bookingId]/reprogramar': 'ClientBusinessShell',
  '/paquetes': 'PackagesBusinessPage',
  '/paquetes/[slug]': 'PackagesBusinessPage',
  '/paquetes/confirmation': 'TenantPublicShell',
  '/tarjeta/[token]': 'TenantPublicShell',
  '/tarjeta/[token]/vincular': 'AuthShell',
  '/review/[bookingId]': 'TenantPublicShell',
  '/notificaciones': 'AuthShell',
  '/baja/[token]': 'TenantPublicShell',
  '/ingresar': 'AuthShell',
  '/login': 'AuthShell',
  '/register': 'AuthShell',
  '/forgot-password': 'AuthShell',
  '/reset-password': 'AuthShell',
  '/recover-business': 'AuthShell',
  '/instalar': 'MarketingShell',
  '/': 'MarketingShell',
  '/privacy': 'LegalShell',
  '/terms': 'LegalShell',
  '/refund-policy': 'LegalShell',
}

function sourceForRoute(route: string): string {
  const directory = route === '/' ? APP_ROOT : join(APP_ROOT, ...route.slice(1).split('/'))
  return readFileSync(join(directory, 'page.tsx'), 'utf8')
}

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

  it('keeps all 22 Track 5 routes on their assigned client, platform or legal shell', () => {
    expect(Object.keys(TRACK_FIVE_SHELLS)).toHaveLength(22)
    for (const [route, shell] of Object.entries(TRACK_FIVE_SHELLS)) {
      expect(sourceForRoute(route), `${route} must compose ${shell}`).toContain(shell)
    }
  })

  it('removes legacy studio shell and palette classes from platform fallbacks', () => {
    for (const path of ['src/app/error.tsx', 'src/app/not-found.tsx', 'src/components/public/public-route-error.tsx', 'src/app/instalar/page.tsx']) {
      expect(readFileSync(join(process.cwd(), path), 'utf8'), path).not.toMatch(/studio-(shell|card|eyebrow)/)
    }
    for (const route of ['/privacy', '/terms', '/refund-policy']) {
      expect(sourceForRoute(route), route).not.toContain('prose-stone')
    }
    expect(readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8')).toContain('<html lang="es-CL"')
    for (const path of ['src/app/error.tsx', 'src/app/b/[slug]/error.tsx', 'src/app/book/error.tsx', 'src/components/public/public-route-error.tsx']) {
      expect(readFileSync(join(process.cwd(), path), 'utf8'), path).toContain('retry')
      expect(readFileSync(join(process.cwd(), path), 'utf8'), path).not.toContain('reset')
    }
  })
})
