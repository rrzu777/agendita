// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requireBusinessRole = vi.hoisted(() => vi.fn())
const upsert = vi.hoisted(() => vi.fn())
const updateMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/server', () => ({ requireBusinessRole }))
vi.mock('@/lib/db', () => ({ prisma: { analyticsInsightPreference: { upsert }, analyticsEmailDelivery: { updateMany } } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setWeeklyInsightPreferences } from '@/server/actions/weekly-insights'

describe('weekly insight preferences', () => {
  beforeEach(() => {
    requireBusinessRole.mockResolvedValue({ businessId: 'biz-a', user: { id: 'user-a', email: 'owner@example.com' }, role: 'owner' })
    upsert.mockResolvedValue({ enabled: true, aiNarrativeEnabled: false, emailEnabled: false, privacyVersion: null })
    updateMany.mockResolvedValue({ count: 1 })
  })
  afterEach(() => vi.clearAllMocks())

  it('requires privacy v2 for assisted analysis', async () => {
    const result = await setWeeklyInsightPreferences({ enabled: true, aiNarrativeEnabled: true, emailEnabled: false, privacyVersion: 1 })
    expect(result).toEqual({ ok: false, error: 'El análisis asistido requiere aceptar la versión vigente de privacidad.' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('stores independent toggles and cancels unstarted emails when revoked', async () => {
    const result = await setWeeklyInsightPreferences({ enabled: true, aiNarrativeEnabled: true, emailEnabled: false, privacyVersion: 2 })
    expect(result).toMatchObject({ ok: true, data: { aiNarrativeEnabled: false, emailEnabled: false } })
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'pending', notificationKind: 'weekly_digest' }), data: { status: 'cancelled' } }))
  })

  it('does not allow admins to activate the AI gate', async () => {
    requireBusinessRole.mockResolvedValue({ businessId: 'biz-a', user: { id: 'admin-a', email: 'admin@example.com' }, role: 'admin' })
    const result = await setWeeklyInsightPreferences({ enabled: true, aiNarrativeEnabled: true, emailEnabled: false, privacyVersion: 2 })
    expect(result).toEqual({ ok: false, error: 'Sólo la persona propietaria puede activar el análisis asistido.' })
  })
})
