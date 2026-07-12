import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUnique = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { business: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))
// unstable_cache: passthrough que ejecuta la fn directamente
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

import { getPackagesBusinessBySlug } from './public'

describe('getPackagesBusinessBySlug', () => {
  beforeEach(() => findUnique.mockReset())

  it('incluye packageProducts activos con sus services y respeta isActive del negocio', async () => {
    findUnique.mockResolvedValue({ id: 'b1', isActive: true, packageProducts: [] })
    const res = await getPackagesBusinessBySlug('demo')
    expect(res).not.toBeNull()
    const arg = findUnique.mock.calls[0][0]
    expect(arg.where).toEqual({ slug: 'demo' })
    expect(arg.include.packageProducts.where).toEqual({ isActive: true })
    expect(arg.include.packageProducts.include.services).toBeTruthy()
  })

  it('devuelve null si el negocio está inactivo', async () => {
    findUnique.mockResolvedValue({ id: 'b1', isActive: false, packageProducts: [] })
    expect(await getPackagesBusinessBySlug('demo')).toBeNull()
  })
})
