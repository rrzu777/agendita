import { describe, it, expect } from 'vitest'
import { ServiceModality } from '@prisma/client'
import {
  resolveBookingModality,
  resolveServiceAddress,
  bookingWhere,
  isNotableModality,
  sortModalities,
  MODALITY_ORDER,
} from '@/lib/services/modality'
import { createServiceSchema } from '@/lib/services/schema'

const { on_site, at_home, online } = ServiceModality

describe('resolveBookingModality', () => {
  it('con una sola modalidad la impone e IGNORA lo que pida el cliente', () => {
    // Server-authoritative: un payload viejo o manipulado no puede pedir
    // domicilio sobre un servicio que sólo se hace en el local.
    expect(resolveBookingModality([on_site], at_home)).toBe(on_site)
    expect(resolveBookingModality([online], on_site)).toBe(online)
  })

  it('con varias, respeta la pedida si está entre las ofrecidas', () => {
    expect(resolveBookingModality([on_site, at_home], at_home)).toBe(at_home)
  })

  it('con varias, rechaza una que el servicio no ofrece', () => {
    expect(() => resolveBookingModality([on_site, at_home], online))
      .toThrow('Ese servicio no se ofrece en esa modalidad')
  })

  it('con varias y sin pedido, cae en la primera del orden canónico', () => {
    expect(resolveBookingModality([online, on_site], undefined)).toBe(on_site)
  })

  it('un servicio sin modalidades (dato corrupto) no tumba la reserva', () => {
    expect(resolveBookingModality([], undefined)).toBe(on_site)
  })
})

describe('resolveServiceAddress', () => {
  it('a domicilio exige dirección', () => {
    expect(() => resolveServiceAddress(at_home, '  ')).toThrow('Necesitamos la dirección')
    expect(resolveServiceAddress(at_home, '  Av. Siempreviva 742 ')).toBe('Av. Siempreviva 742')
  })

  it('fuera de domicilio la descarta, aunque llegue', () => {
    // Guardarla dejaría un dato que nadie muestra y que contradice la modalidad.
    expect(resolveServiceAddress(on_site, 'Av. Siempreviva 742')).toBeNull()
    expect(resolveServiceAddress(online, 'Av. Siempreviva 742')).toBeNull()
  })
})

describe('bookingWhere', () => {
  it('en el local no repite la dirección del negocio (listas del dashboard)', () => {
    expect(bookingWhere({ modality: on_site })).toEqual({
      label: 'En el local', detail: null, href: null,
    })
  })

  it('en el local con businessAddress la muestra, con link al mapa (/mi)', () => {
    const where = bookingWhere({ modality: on_site }, { businessAddress: 'Av. Matta 456' })
    expect(where.label).toBe('En el local')
    expect(where.detail).toBe('Av. Matta 456')
    expect(where.href).toContain('google.com/maps')
    expect(where.href).toContain(encodeURIComponent('Av. Matta 456'))
  })

  it('a domicilio muestra la dirección de la clienta, sin link', () => {
    expect(bookingWhere({ modality: at_home, serviceAddress: 'Los Olmos 12' })).toEqual({
      label: 'A domicilio', detail: 'Los Olmos 12', href: null,
    })
  })

  it('online muestra el link ya resuelto como href', () => {
    expect(bookingWhere({ modality: online, meetingUrl: 'https://meet.example/x' })).toEqual({
      label: 'Online', detail: 'https://meet.example/x', href: 'https://meet.example/x',
    })
  })

  it('online con un link no navegable lo deja como texto (href null)', () => {
    // Segundo cerrojo del XSS de `javascript:` — el mismo criterio de
    // linkNavegable que usan whereRows y el .ics.
    for (const url of ['javascript:alert(1)', 'https://sala\r\nX-EVIL:1']) {
      const where = bookingWhere({ modality: online, meetingUrl: url })
      expect(where.detail).toBe(url)
      expect(where.href).toBeNull()
    }
  })

  it('sólo domicilio y online valen la pena en una lista', () => {
    expect(isNotableModality(on_site)).toBe(false)
    expect(isNotableModality(at_home)).toBe(true)
    expect(isNotableModality(online)).toBe(true)
  })
})

describe('sortModalities', () => {
  it('devuelve siempre el orden canónico, no el de entrada', () => {
    expect(sortModalities([online, on_site])).toEqual([on_site, online])
    expect(sortModalities([...MODALITY_ORDER].reverse())).toEqual(MODALITY_ORDER)
  })
})

describe('createServiceSchema.modalities', () => {
  const base = {
    name: 'Corte', durationMinutes: 30, price: 10000, depositAmount: 0, pastelColor: '#f4dbca',
  }

  it('sin modalidades explícitas, el servicio se atiende en el local', () => {
    const parsed = createServiceSchema.parse(base)
    expect(parsed.modalities).toEqual([on_site])
  })

  it('una lista vacía se rechaza: un servicio sin modalidad no se reserva en ningún lado', () => {
    expect(createServiceSchema.safeParse({ ...base, modalities: [] }).success).toBe(false)
  })

  it('deduplica repetidos (dos clicks rápidos en el mismo checkbox)', () => {
    const parsed = createServiceSchema.parse({ ...base, modalities: [at_home, at_home, on_site] })
    expect(parsed.modalities).toEqual([at_home, on_site])
  })
})
