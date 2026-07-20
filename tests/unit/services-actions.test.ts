import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPrisma = {
  service: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}

const mockRequireBusiness = vi.fn()
const mockRequireBusinessRole = vi.fn()
const mockCheckRateLimit = vi.fn()
const mockRevalidatePath = vi.fn()
const mockRevalidateBusinessPublicPaths = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}))

vi.mock('@/lib/auth/server', async () => {
  // ForbiddenError debe extender el UserError REAL: así el wrapper action()
  // lo reconoce (instanceof UserError) y devuelve su mensaje en { ok:false },
  // en vez de redactarlo al genérico. Mismo contrato que la clase de producción.
  const { UserError } = await import('@/lib/actions/result')
  return {
    requireBusiness: mockRequireBusiness,
    requireBusinessRole: mockRequireBusinessRole,
    ForbiddenError: class ForbiddenError extends UserError {
      constructor(message = 'No tienes permisos') {
        super(message)
        this.name = 'ForbiddenError'
      }
    },
  }
})

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: mockRevalidateBusinessPublicPaths,
}))

const {
  getServices,
  createService,
  updateService,
  toggleService,
  deleteService,
  reorderServices,
} = await import('@/server/actions/services')

const validServiceData = {
  name: 'Corte de pelo',
  description: 'Corte clásico',
  durationMinutes: 30,
  price: 15000,
  depositAmount: 5000,
  pastelColor: '#FFB3BA',
}

const createdService = {
  id: 'svc-1',
  businessId: 'biz-1',
  isActive: true,
  sortOrder: 0,
  ...validServiceData,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('services actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckRateLimit.mockResolvedValue({ success: true })
    mockRequireBusiness.mockResolvedValue({ businessId: 'biz-1' })
    mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1' })
    mockRevalidateBusinessPublicPaths.mockResolvedValue(undefined)
  })

  describe('getServices', () => {
    it('returns only active services by default', async () => {
      mockPrisma.service.findMany.mockResolvedValue([createdService])

      await getServices()

      expect(mockPrisma.service.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true, businessId: 'biz-1' } })
      )
    })

    it('returns all services when includeInactive=true', async () => {
      mockPrisma.service.findMany.mockResolvedValue([createdService])

      await getServices(true)

      expect(mockPrisma.service.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { businessId: 'biz-1' } })
      )
    })

    it('uses businessId from session', async () => {
      mockRequireBusiness.mockResolvedValue({ businessId: 'session-biz-999' })
      mockPrisma.service.findMany.mockResolvedValue([])

      await getServices()

      expect(mockPrisma.service.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ businessId: 'session-biz-999' }) })
      )
    })
  })

  describe('createService', () => {
    it('creates service with session businessId', async () => {
      mockRequireBusinessRole.mockResolvedValue({ businessId: 'session-biz-123' })
      mockPrisma.service.create.mockResolvedValue({ ...createdService, businessId: 'session-biz-123' })

      const result = await createService(validServiceData)

      expect(mockPrisma.service.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ businessId: 'session-biz-123' }),
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(result.data.businessId).toBe('session-biz-123')
    })

    it('ignores businessId from input data', async () => {
      mockRequireBusinessRole.mockResolvedValue({ businessId: 'biz-1' })
      mockPrisma.service.create.mockResolvedValue(createdService)

      const result = await createService({ ...validServiceData, businessId: 'malicious' })

      expect(result.ok).toBe(true)
      expect(mockPrisma.service.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ businessId: 'biz-1' }),
      })
    })

    it('rejects invalid data', async () => {
      const result = await createService({ name: '' })
      expect(!result.ok && result.error).toContain('Datos inválidos')
      expect(mockPrisma.service.create).not.toHaveBeenCalled()
    })

    it('revalidates dashboard and public paths on success', async () => {
      mockPrisma.service.create.mockResolvedValue(createdService)

      const result = await createService(validServiceData)

      expect(result.ok).toBe(true)
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/services')
      expect(mockRevalidateBusinessPublicPaths).toHaveBeenCalledWith('biz-1')
    })

    it('rejects when rate limited', async () => {
      mockCheckRateLimit.mockResolvedValue({ success: false })

      const result = await createService(validServiceData)
      expect(!result.ok && result.error).toContain('Demasiadas solicitudes')
      expect(mockPrisma.service.create).not.toHaveBeenCalled()
    })
  })

  describe('updateService', () => {
    it('updates service that belongs to business', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'biz-1', price: 15000, depositAmount: 5000 })
      mockPrisma.service.update.mockResolvedValue(createdService)

      const result = await updateService('svc-1', { name: 'Nuevo nombre' })

      expect(mockPrisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
        data: { name: 'Nuevo nombre' },
      })
      expect(result.ok).toBe(true)
    })

    it('rejects update of service from another business', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'other-biz', price: 0, depositAmount: 0 })

      const result = await updateService('svc-1', { name: 'Nuevo nombre' })
      expect(result).toEqual({ ok: false, error: 'Servicio no encontrado' })
      expect(mockPrisma.service.update).not.toHaveBeenCalled()
    })

    it('rejects update of non-existent service', async () => {
      mockPrisma.service.findUnique.mockResolvedValue(null)

      const result = await updateService('svc-1', { name: 'Nuevo nombre' })
      expect(result).toEqual({ ok: false, error: 'Servicio no encontrado' })
      expect(mockPrisma.service.update).not.toHaveBeenCalled()
    })

    it('rejects empty update data', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'biz-1', price: 0, depositAmount: 0 })

      const result = await updateService('svc-1', {})
      expect(result).toEqual({ ok: false, error: 'No hay campos para actualizar' })
      expect(mockPrisma.service.update).not.toHaveBeenCalled()
    })

    it('ignores businessId in update data', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'biz-1', price: 15000, depositAmount: 5000 })
      mockPrisma.service.update.mockResolvedValue(createdService)

      const result = await updateService('svc-1', { name: 'Test', businessId: 'other-biz' })

      expect(result.ok).toBe(true)
      expect(mockPrisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
        data: { name: 'Test' },
      })
    })

    it('rejects update when new price is below current deposit', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'biz-1', price: 10000, depositAmount: 5000 })

      const result = await updateService('svc-1', { price: 3000 })
      expect(result).toEqual({ ok: false, error: 'El abono no puede superar el precio' })
      expect(mockPrisma.service.update).not.toHaveBeenCalled()
    })

    it('rejects update when new deposit is above current price', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'biz-1', price: 10000, depositAmount: 5000 })

      const result = await updateService('svc-1', { depositAmount: 12000 })
      expect(result).toEqual({ ok: false, error: 'El abono no puede superar el precio' })
      expect(mockPrisma.service.update).not.toHaveBeenCalled()
    })

    it('allows partial update that preserves deposit <= price', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'biz-1', price: 10000, depositAmount: 5000 })
      mockPrisma.service.update.mockResolvedValue(createdService)

      const result = await updateService('svc-1', { name: 'Nuevo nombre' })

      expect(result.ok).toBe(true)
      expect(mockPrisma.service.update).toHaveBeenCalled()
    })

    it('allows update of both price and deposit when final result is valid', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'biz-1', price: 10000, depositAmount: 5000 })
      mockPrisma.service.update.mockResolvedValue({ ...createdService, price: 20000, depositAmount: 8000 })

      const result = await updateService('svc-1', { price: 20000, depositAmount: 8000 })

      expect(mockPrisma.service.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { price: 20000, depositAmount: 8000 } })
      )
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(result.data.price).toBe(20000)
    })

    it('revalidates after successful update', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'biz-1', price: 15000, depositAmount: 5000 })
      mockPrisma.service.update.mockResolvedValue(createdService)

      const result = await updateService('svc-1', { name: 'Test' })

      expect(result.ok).toBe(true)
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/services')
      expect(mockRevalidateBusinessPublicPaths).toHaveBeenCalledWith('biz-1')
    })
  })

  describe('toggleService', () => {
    it('toggles isActive from true to false', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'biz-1', isActive: true })
      mockPrisma.service.update.mockResolvedValue({ ...createdService, isActive: false })

      const result = await toggleService('svc-1')

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(result.data.isActive).toBe(false)
      expect(mockPrisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
        data: { isActive: false },
      })
    })

    it('toggles isActive from false to true', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'biz-1', isActive: false })
      mockPrisma.service.update.mockResolvedValue({ ...createdService, isActive: true })

      const result = await toggleService('svc-1')

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(result.data.isActive).toBe(true)
      expect(mockPrisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
        data: { isActive: true },
      })
    })

    it('rejects toggle of service from another business', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'other-biz', isActive: true })

      const result = await toggleService('svc-1')
      expect(result).toEqual({ ok: false, error: 'Servicio no encontrado' })
      expect(mockPrisma.service.update).not.toHaveBeenCalled()
    })

    it('rejects toggle of non-existent service', async () => {
      mockPrisma.service.findUnique.mockResolvedValue(null)

      const result = await toggleService('svc-1')
      expect(result).toEqual({ ok: false, error: 'Servicio no encontrado' })
      expect(mockPrisma.service.update).not.toHaveBeenCalled()
    })

    it('revalidates after toggle', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'biz-1', isActive: true })
      mockPrisma.service.update.mockResolvedValue(createdService)

      const result = await toggleService('svc-1')

      expect(result.ok).toBe(true)
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/services')
      expect(mockRevalidateBusinessPublicPaths).toHaveBeenCalledWith('biz-1')
    })
  })

  describe('deleteService (soft delete)', () => {
    it('sets isActive to false, does not delete row', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'biz-1' })
      mockPrisma.service.update.mockResolvedValue({ ...createdService, isActive: false })

      const result = await deleteService('svc-1')

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected ok result')
      expect(result.data.isActive).toBe(false)
      expect(result.data.id).toBe('svc-1')
      expect(mockPrisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
        data: { isActive: false },
      })
    })

    it('rejects delete of service from another business', async () => {
      mockPrisma.service.findUnique.mockResolvedValue({ businessId: 'other-biz' })

      const result = await deleteService('svc-1')
      expect(result).toEqual({ ok: false, error: 'Servicio no encontrado' })
      expect(mockPrisma.service.update).not.toHaveBeenCalled()
    })

    it('rejects delete of non-existent service', async () => {
      mockPrisma.service.findUnique.mockResolvedValue(null)

      const result = await deleteService('svc-1')
      expect(result).toEqual({ ok: false, error: 'Servicio no encontrado' })
      expect(mockPrisma.service.update).not.toHaveBeenCalled()
    })
  })

  describe('reorderServices', () => {
    const reorderItems = [
      { id: 'svc-1', sortOrder: 0 },
      { id: 'svc-2', sortOrder: 1 },
      { id: 'svc-3', sortOrder: 2 },
    ]

    it('uses transaction to update sort orders', async () => {
      mockPrisma.service.findMany.mockResolvedValue([
        { id: 'svc-1' },
        { id: 'svc-2' },
        { id: 'svc-3' },
      ])

      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        return fn(mockPrisma)
      })

      const result = await reorderServices(reorderItems)

      expect(result.ok).toBe(true)
      expect(mockPrisma.$transaction).toHaveBeenCalled()
      expect(mockPrisma.service.update).toHaveBeenCalledTimes(3)
      expect(mockPrisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-1' },
        data: { sortOrder: 0 },
      })
      expect(mockPrisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-2' },
        data: { sortOrder: 1 },
      })
      expect(mockPrisma.service.update).toHaveBeenCalledWith({
        where: { id: 'svc-3' },
        data: { sortOrder: 2 },
      })
    })

    it('rejects reorder when some ids belong to another business', async () => {
      mockPrisma.service.findMany.mockResolvedValue([
        { id: 'svc-1' },
        { id: 'svc-2' },
      ])

      const result = await reorderServices(reorderItems)
      expect(result).toEqual({ ok: false, error: 'Uno o más servicios no pertenecen a este negocio' })
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('rejects reorder when no ids match', async () => {
      mockPrisma.service.findMany.mockResolvedValue([])

      const result = await reorderServices(reorderItems)
      expect(result).toEqual({ ok: false, error: 'Uno o más servicios no pertenecen a este negocio' })
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('validates business ownership with businessId', async () => {
      mockPrisma.service.findMany.mockResolvedValue([
        { id: 'svc-1' },
        { id: 'svc-2' },
        { id: 'svc-3' },
      ])

      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        return fn(mockPrisma)
      })

      const result = await reorderServices(reorderItems)

      expect(result.ok).toBe(true)
      expect(mockPrisma.service.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['svc-1', 'svc-2', 'svc-3'] }, businessId: 'biz-1' },
        select: { id: true },
      })
    })

    it('revalidates after successful reorder', async () => {
      mockPrisma.service.findMany.mockResolvedValue([
        { id: 'svc-1' },
        { id: 'svc-2' },
        { id: 'svc-3' },
      ])

      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        return fn(mockPrisma)
      })

      const result = await reorderServices(reorderItems)

      expect(result.ok).toBe(true)
      expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/services')
      expect(mockRevalidateBusinessPublicPaths).toHaveBeenCalledWith('biz-1')
    })

    it('rejects when rate limited', async () => {
      mockCheckRateLimit.mockResolvedValue({ success: false })

      const result = await reorderServices(reorderItems)
      expect(!result.ok && result.error).toContain('Demasiadas solicitudes')
      expect(mockPrisma.service.findMany).not.toHaveBeenCalled()
    })
  })
})
