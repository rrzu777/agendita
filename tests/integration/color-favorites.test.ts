import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import {
  addBusinessColorFavorite,
  ColorFavoriteLimitError,
  listBusinessColorFavorites,
  removeBusinessColorFavorite,
} from '@/lib/business/color-favorites'
import { requireTestDatabase } from './setup'

requireTestDatabase()

const RUN_ID = randomUUID().replace(/-/g, '').slice(0, 16)
const FIRST_BUSINESS = `color-favorites-first-${RUN_ID}`
const SECOND_BUSINESS = `color-favorites-second-${RUN_ID}`
const OWNER = `color-favorites-owner-${RUN_ID}`
const FAVORITES = [
  '#102030', '#203040', '#304050', '#405060', '#506070', '#607080',
  '#708090', '#8090A0', '#90A0B0', '#A0B0C0', '#B0C0D0', '#C0D0E0',
]
const writerUrl = new URL(process.env.DATABASE_URL!)
writerUrl.searchParams.set('connection_limit', '1')
const TEST_URL = writerUrl.toString()

async function backendPid(client: PrismaClient): Promise<number> {
  const rows = await client.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
  return rows[0]!.pid
}

async function waitUntilBlocked(waiterPid: number, holderPid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ blockers: number[] }[]>`SELECT pg_blocking_pids(CAST(${waiterPid} AS integer)) AS blockers`
    if (rows[0]?.blockers.includes(holderPid)) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Writer backend ${waiterPid} never blocked on advisory lock held by ${holderPid}`)
}

async function cleanup() {
  await prisma.businessColorFavorite.deleteMany({
    where: { businessId: { in: [FIRST_BUSINESS, SECOND_BUSINESS] } },
  })
  await prisma.business.deleteMany({ where: { id: { in: [FIRST_BUSINESS, SECOND_BUSINESS] } } })
  await prisma.user.deleteMany({ where: { id: OWNER } })
}

beforeAll(async () => {
  await cleanup()
  await prisma.user.create({ data: { id: OWNER, email: `color-favorites-owner-${RUN_ID}@test.test` } })
  await prisma.business.createMany({
    data: [
      { id: FIRST_BUSINESS, ownerUserId: OWNER, name: 'Colores Uno', city: 'Santiago', slug: `colores-uno-${RUN_ID}`, subdomain: `colores-uno-${RUN_ID}` },
      { id: SECOND_BUSINESS, ownerUserId: OWNER, name: 'Colores Dos', city: 'Santiago', slug: `colores-dos-${RUN_ID}`, subdomain: `colores-dos-${RUN_ID}` },
    ],
  })
})

afterAll(async () => {
  await cleanup()
  await prisma.$disconnect()
})

describe('BusinessColorFavorite repository', () => {
  it('normalizes duplicate colors without leaking them to another tenant', async () => {
    await addBusinessColorFavorite(FIRST_BUSINESS, '#a1b2c3')
    await addBusinessColorFavorite(FIRST_BUSINESS, '#A1B2C3')
    await addBusinessColorFavorite(SECOND_BUSINESS, '#A1B2C3')

    await expect(listBusinessColorFavorites(FIRST_BUSINESS)).resolves.toEqual(['#A1B2C3'])
    await expect(listBusinessColorFavorites(SECOND_BUSINESS)).resolves.toEqual(['#A1B2C3'])
    expect(await prisma.businessColorFavorite.count({ where: { businessId: { in: [FIRST_BUSINESS, SECOND_BUSINESS] } } })).toBe(2)
  })

  it('treats deleting an absent color and adding an existing color at the limit as successful', async () => {
    await prisma.businessColorFavorite.deleteMany({ where: { businessId: FIRST_BUSINESS } })
    for (const color of FAVORITES) await addBusinessColorFavorite(FIRST_BUSINESS, color)

    await expect(addBusinessColorFavorite(FIRST_BUSINESS, FAVORITES[0].toLowerCase())).resolves.toHaveLength(12)
    await expect(removeBusinessColorFavorite(FIRST_BUSINESS, '#FFFFFF')).resolves.toHaveLength(12)
  })

  it('serializes two real PostgreSQL writers when only one distinct favorite slot remains', async () => {
    await prisma.businessColorFavorite.deleteMany({ where: { businessId: SECOND_BUSINESS } })
    for (const color of FAVORITES.slice(0, 11)) await addBusinessColorFavorite(SECOND_BUSINESS, color)

    const firstWriter = new PrismaClient({ datasources: { db: { url: TEST_URL } } })
    const secondWriter = new PrismaClient({ datasources: { db: { url: TEST_URL } } })
    let releaseFirst!: () => void
    const holdFirst = new Promise<void>((resolve) => { releaseFirst = resolve })
    let firstLockAcquired!: () => void
    const firstLocked = new Promise<void>((resolve) => { firstLockAcquired = resolve })
    let firstWrite: Promise<string[]> | undefined
    let secondWrite: Promise<string[]> | undefined
    let writes: PromiseSettledResult<string[]>[] = []
    try {
      await Promise.all([firstWriter.$connect(), secondWriter.$connect()])
      const [firstPid, secondPid] = await Promise.all([backendPid(firstWriter), backendPid(secondWriter)])
      expect(firstPid).not.toBe(secondPid)

      firstWrite = addBusinessColorFavorite(SECOND_BUSINESS, '#D0E0F0', {
        client: firstWriter,
        onLockAcquired: async () => { firstLockAcquired(); await holdFirst },
      })
      await firstLocked
      secondWrite = addBusinessColorFavorite(SECOND_BUSINESS, '#E0F0A0', { client: secondWriter })
      await waitUntilBlocked(secondPid, firstPid)
    } finally {
      releaseFirst?.()
      if (firstWrite && secondWrite) writes = await Promise.allSettled([firstWrite, secondWrite])
      else if (firstWrite) writes = [await Promise.allSettled([firstWrite]).then(([result]) => result)]
      await firstWriter.$disconnect()
      await secondWriter.$disconnect()
    }
    expect(writes.filter((write) => write.status === 'fulfilled')).toHaveLength(1)
    expect(writes.filter((write) => write.status === 'rejected')).toHaveLength(1)
    const rejected = writes.find((write): write is PromiseRejectedResult => write.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(ColorFavoriteLimitError)
    await expect(listBusinessColorFavorites(SECOND_BUSINESS)).resolves.toHaveLength(12)
  })
})
