import 'server-only'

import { prisma } from '@/lib/db'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-lock'
import type { Prisma } from '@prisma/client'

export const MAX_BUSINESS_COLOR_FAVORITES = 12

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/

export class ColorFavoriteInputError extends Error {
  constructor(message: string) { super(message); this.name = 'ColorFavoriteInputError' }
}
export class ColorFavoriteLimitError extends Error {
  constructor(message: string) { super(message); this.name = 'ColorFavoriteLimitError' }
}

type FavoriteMutationOptions = {
  client?: typeof prisma
  // Testing/diagnostic seam: production callers omit it. It runs only after the
  // actual transaction lock is acquired, so it can prove independent writers
  // serialize on PostgreSQL rather than merely sharing one JS promise queue.
  onLockAcquired?: (tx: Prisma.TransactionClient) => Promise<void> | void
}

export function normalizeBusinessColorFavorite(value: string): string | null {
  const normalized = value.trim()
  return HEX_COLOR.test(normalized) ? normalized.toUpperCase() : null
}

function validFavoriteColor(value: string): string {
  const color = normalizeBusinessColorFavorite(value)
  if (!color) throw new ColorFavoriteInputError('Usa un color hexadecimal como #B64D68.')
  return color
}

async function listInTransaction(tx: Prisma.TransactionClient, businessId: string): Promise<string[]> {
  const favorites = await tx.businessColorFavorite.findMany({
    where: { businessId },
    orderBy: { createdAt: 'asc' },
    select: { color: true },
  })
  return favorites.map((favorite) => favorite.color)
}

export async function listBusinessColorFavorites(businessId: string): Promise<string[]> {
  const favorites = await prisma.businessColorFavorite.findMany({
    where: { businessId },
    orderBy: { createdAt: 'asc' },
    select: { color: true },
  })
  return favorites.map((favorite) => favorite.color)
}

/**
 * Adds one color without replacing the collection. The transaction lock is the
 * concurrency boundary for the per-tenant maximum, including separate Prisma
 * clients/requests that would otherwise observe the same remaining slot.
 */
export async function addBusinessColorFavorite(businessId: string, rawColor: string, options: FavoriteMutationOptions = {}): Promise<string[]> {
  const color = validFavoriteColor(rawColor)
  const client = options.client ?? prisma

  return client.$transaction(async (tx) => {
    await acquireAdvisoryXactLock(tx, `business-color-favorites:${businessId}`)
    await options.onLockAcquired?.(tx)

    const existing = await tx.businessColorFavorite.findUnique({
      where: { businessId_color: { businessId, color } },
      select: { id: true },
    })
    if (existing) return listInTransaction(tx, businessId)

    const count = await tx.businessColorFavorite.count({ where: { businessId } })
    if (count >= MAX_BUSINESS_COLOR_FAVORITES) {
      throw new ColorFavoriteLimitError('Puedes guardar hasta 12 colores favoritos.')
    }

    await tx.businessColorFavorite.create({ data: { businessId, color } })
    return listInTransaction(tx, businessId)
  })
}

/** Deleting a missing saved color is deliberately idempotent. */
export async function removeBusinessColorFavorite(businessId: string, rawColor: string, options: FavoriteMutationOptions = {}): Promise<string[]> {
  const color = validFavoriteColor(rawColor)
  const client = options.client ?? prisma

  return client.$transaction(async (tx) => {
    await acquireAdvisoryXactLock(tx, `business-color-favorites:${businessId}`)
    await tx.businessColorFavorite.deleteMany({ where: { businessId, color } })
    return listInTransaction(tx, businessId)
  })
}
