import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'

const requireBusiness = vi.fn()
const requireBusinessRole = vi.fn()
const checkRateLimit = vi.fn()
const listFavorites = vi.fn()
const addFavorite = vi.fn()
const removeFavorite = vi.fn()

vi.mock('@/lib/auth/server', () => ({ requireBusiness, requireBusinessRole, ForbiddenError }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit }))
vi.mock('@/lib/business/color-favorites', () => ({
  listBusinessColorFavorites: listFavorites,
  addBusinessColorFavorite: addFavorite,
  removeBusinessColorFavorite: removeFavorite,
  normalizeBusinessColorFavorite: (value: string) => /^#[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : null,
  ColorFavoriteInputError: class ColorFavoriteInputError extends Error {},
  ColorFavoriteLimitError: class ColorFavoriteLimitError extends Error {},
}))

const { addColorFavorite, getColorFavorites, removeColorFavorite } = await import('@/server/actions/color-favorites')

describe('color favorite actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireBusiness.mockResolvedValue({ businessId: 'session-business' })
    requireBusinessRole.mockResolvedValue({ businessId: 'session-business' })
    checkRateLimit.mockResolvedValue({ success: true })
    listFavorites.mockResolvedValue(['#35524A'])
    addFavorite.mockResolvedValue(['#35524A', '#A1B2C3'])
    removeFavorite.mockResolvedValue(['#35524A'])
  })

  it('reads only the tenant derived from requireBusiness', async () => {
    await expect(getColorFavorites()).resolves.toEqual(['#35524A'])
    expect(listFavorites).toHaveBeenCalledWith('session-business')
  })

  it('uses owner/admin authorization and has no client business-id parameter', async () => {
    const result = await addColorFavorite('#a1b2c3')

    expect(requireBusinessRole).toHaveBeenCalledWith(['owner', 'admin'])
    expect(addFavorite).toHaveBeenCalledWith('session-business', '#A1B2C3')
    expect(result).toEqual({ ok: true, data: ['#35524A', '#A1B2C3'] })
  })

  it('returns the permission error for staff before any favorite mutation', async () => {
    requireBusinessRole.mockRejectedValue(new ForbiddenError())

    const result = await removeColorFavorite('#35524A')

    expect(result).toEqual({ ok: false, error: 'No tienes permisos para realizar esta acción' })
    expect(removeFavorite).not.toHaveBeenCalled()
  })

  it('rejects malformed colors before rate limiting or database access', async () => {
    const result = await addColorFavorite('#12')

    expect(result).toEqual({ ok: false, error: 'Usa un color hexadecimal como #B64D68.' })
    expect(checkRateLimit).not.toHaveBeenCalled()
    expect(addFavorite).not.toHaveBeenCalled()
  })
})
