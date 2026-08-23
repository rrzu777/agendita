import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getDashboardNavItems } from '@/lib/dashboard/navigation'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('dashboard navigation and action layout', () => {
  it('keeps exactly three primary destinations in the mobile bar', () => {
    const vocabulary = { Professionals: 'Profesionales', Clients: 'Clientes' } as never
    const mobile = getDashboardNavItems(vocabulary, 'owner').filter((item) => item.mobile === 'primary')

    expect(mobile.map((item) => item.href)).toEqual([
      '/dashboard',
      '/dashboard/bookings',
      '/dashboard/calendar',
    ])
  })

  it('keeps the desktop sidebar in the viewport and scrolls only its navigation', () => {
    const sidebar = source('src/components/dashboard/sidebar.tsx')

    expect(sidebar).toContain('sticky top-0 h-screen min-h-0')
    expect(sidebar).toContain("'min-h-0 flex-1 overflow-y-auto'")
  })

  it('routes dashboard-owned links and sign-out through the unsaved-change guard', () => {
    const sidebar = source('src/components/dashboard/sidebar.tsx')
    const layout = source('src/app/dashboard/layout.tsx')

    expect(sidebar).toContain("import { GuardedLink, useUnsavedChanges } from '@/components/dashboard/unsaved-changes-provider'")
    expect(sidebar).toContain('<GuardedLink')
    expect(sidebar).toContain('onSubmit={handleSignOut}')
    expect(layout).toContain('<UnsavedChangesProvider>')
  })

  it('keeps booking creation and search together on desktop and separated on mobile', () => {
    const bookings = source('src/app/dashboard/bookings/page.tsx')

    expect(bookings).toContain('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between')
    expect(bookings).toContain('flex w-full flex-col gap-2 sm:max-w-xl sm:flex-row sm:items-center')
  })

  it('aligns the payment action with the date controls', () => {
    const payments = source('src/app/dashboard/payments/page.tsx')

    expect(payments).toContain('sm:items-end sm:justify-between')
    expect(payments).toContain('flex flex-wrap items-end justify-end gap-3')
  })
})
