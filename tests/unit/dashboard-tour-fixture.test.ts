import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BusinessRole } from '@prisma/client'
import {
  cleanupDashboardFixture,
  createDashboardFixture,
  type DashboardFixtureClient,
} from '../e2e/helpers/dashboard-tour-fixture'

type FakeState = {
  businesses: Array<{ id: string; ownerUserId: string }>
  memberships: Array<{ businessId: string; role: BusinessRole; userId: string }>
  users: Array<{ email: string; id: string }>
}

function fakeFixtureClient({ failMembership = false } = {}) {
  let state: FakeState = { businesses: [], memberships: [], users: [] }
  let id = 0
  const nextId = (prefix: string) => `${prefix}-${++id}`
  const tx = {
    booking: { create: vi.fn(async () => ({ id: nextId('booking') })) },
    business: { create: vi.fn(async ({ data }: { data: { ownerUserId: string } }) => {
      const business = { id: nextId('business'), ownerUserId: data.ownerUserId }
      state.businesses.push(business)
      return business
    }) },
    businessUser: { create: vi.fn(async ({ data }: { data: FakeState['memberships'][number] }) => {
      if (failMembership) throw new Error('membership failed')
      state.memberships.push(data)
      return { id: nextId('membership'), ...data }
    }) },
    customer: { create: vi.fn(async () => ({ id: nextId('customer') })) },
    service: { create: vi.fn(async () => ({ id: nextId('service') })) },
    user: { create: vi.fn(async ({ data }: { data: { email: string } }) => {
      const user = { email: data.email, id: nextId('user') }
      state.users.push(user)
      return user
    }) },
  }
  const client = {
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      const snapshot = structuredClone(state)
      try {
        return await callback(tx)
      } catch (error) {
        state = snapshot
        throw error
      }
    }),
    business: { delete: vi.fn(async () => ({})) },
    user: { delete: vi.fn(async () => ({})) },
  } as unknown as DashboardFixtureClient

  return { client, getState: () => state }
}

describe('dashboard tour fixture safety', () => {
  beforeEach(() => {
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://postgres:test-only@127.0.0.1:55437/agendita_tours_test',
    )
  })

  it('fails before opening a transaction when the database URL is unsafe', async () => {
    const { client } = fakeFixtureClient()
    vi.stubEnv('DATABASE_URL', 'postgresql://app:unsafe@db.example.com/agendita')

    await expect(createDashboardFixture(client, { role: 'owner' }))
      .rejects.toThrow(/Unsafe DATABASE_URL/)

    expect(client.$transaction).not.toHaveBeenCalled()
  })

  it.each(['admin', 'staff'] as const)('creates a distinct owner for a %s actor', async (role) => {
    const { client, getState } = fakeFixtureClient()

    const fixture = await createDashboardFixture(client, { role })

    expect(fixture.ownerUserId).not.toBe(fixture.userId)
    expect(getState().businesses).toEqual([
      expect.objectContaining({ ownerUserId: fixture.ownerUserId }),
    ])
    expect(getState().memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'owner', userId: fixture.ownerUserId }),
      expect.objectContaining({ role, userId: fixture.userId }),
    ]))
  })

  it('rolls back retained users and business when a middle create fails', async () => {
    const { client, getState } = fakeFixtureClient({ failMembership: true })

    await expect(createDashboardFixture(client, { role: 'admin' }))
      .rejects.toThrow('membership failed')

    expect(getState()).toEqual({ businesses: [], memberships: [], users: [] })
  })

  it('attempts business and every identity cleanup even when deletes fail', async () => {
    const { client } = fakeFixtureClient()
    vi.mocked(client.business.delete).mockRejectedValueOnce(new Error('business failed'))
    vi.mocked(client.user.delete).mockRejectedValueOnce(new Error('actor failed'))

    await expect(cleanupDashboardFixture(client, {
      businessId: 'business-1',
      email: 'actor@e2e.agendita.test',
      ownerUserId: 'owner-1',
      userId: 'actor-1',
    })).rejects.toBeInstanceOf(AggregateError)

    expect(client.business.delete).toHaveBeenCalledWith({ where: { id: 'business-1' } })
    expect(client.user.delete).toHaveBeenCalledTimes(2)
    expect(client.user.delete).toHaveBeenCalledWith({ where: { id: 'actor-1' } })
    expect(client.user.delete).toHaveBeenCalledWith({ where: { id: 'owner-1' } })
  })
})
