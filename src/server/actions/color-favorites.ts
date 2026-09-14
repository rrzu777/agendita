'use server'

import { action, UserError } from '@/lib/actions/result'
import { requireBusiness, requireBusinessRole } from '@/lib/auth/server'
import {
  addBusinessColorFavorite,
  ColorFavoriteInputError,
  ColorFavoriteLimitError,
  listBusinessColorFavorites,
  normalizeBusinessColorFavorite,
  removeBusinessColorFavorite,
} from '@/lib/business/color-favorites'
import { checkRateLimit } from '@/lib/rate-limit'

export async function getColorFavorites(): Promise<string[]> {
  const { businessId } = await requireBusiness()
  return listBusinessColorFavorites(businessId)
}

async function assertMutationBudget(businessId: string) {
  const limit = await checkRateLimit('manage-color-favorites', 30, 60_000, { businessId })
  if (!limit.success) throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
}

async function _addColorFavorite(rawColor: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const color = normalizeBusinessColorFavorite(rawColor)
  if (!color) throw new UserError('Usa un color hexadecimal como #B64D68.')
  await assertMutationBudget(businessId)
  try {
    return await addBusinessColorFavorite(businessId, color)
  } catch (error) {
    if (error instanceof ColorFavoriteInputError || error instanceof ColorFavoriteLimitError) {
      throw new UserError(error.message)
    }
    throw error
  }
}

async function _removeColorFavorite(rawColor: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const color = normalizeBusinessColorFavorite(rawColor)
  if (!color) throw new UserError('Usa un color hexadecimal como #B64D68.')
  await assertMutationBudget(businessId)
  try {
    return await removeBusinessColorFavorite(businessId, color)
  } catch (error) {
    if (error instanceof ColorFavoriteInputError) throw new UserError(error.message)
    throw error
  }
}

export const addColorFavorite = action(_addColorFavorite)
export const removeColorFavorite = action(_removeColorFavorite)
