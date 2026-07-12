import { describe, it, expect, vi, beforeEach } from 'vitest'

const revalidateTag = vi.fn()
const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a), revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
const findUnique = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { business: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))

import { revalidateBusinessPublicPaths } from './revalidate-business'

describe('revalidateBusinessPublicPaths', () => {
  beforeEach(() => { revalidateTag.mockReset(); revalidatePath.mockReset(); findUnique.mockReset() })

  it('invalida también los tags y paths de paquetes', async () => {
    findUnique.mockResolvedValue({ slug: 'demo', subdomain: null })
    await revalidateBusinessPublicPaths('b1')
    expect(revalidateTag).toHaveBeenCalledWith('packages-business-by-slug', 'max')
    expect(revalidateTag).toHaveBeenCalledWith('packages-business-by-subdomain', 'max')
    expect(revalidatePath).toHaveBeenCalledWith('/paquetes')
    expect(revalidatePath).toHaveBeenCalledWith('/paquetes/demo')
  })
})
