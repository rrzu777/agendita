import { describe, it, expect } from 'vitest'
import { ServiceModality } from '@prisma/client'
import { deriveModalities } from '@/lib/professionals/modalities'
import {
  createProfessionalSchema,
  updateProfessionalSchema,
} from '@/lib/professionals/schema'

describe('deriveModalities', () => {
  it('sin servicios cae en el local, que es el default del schema', () => {
    expect(deriveModalities([])).toEqual([ServiceModality.on_site])
  })

  it('une las modalidades de todos los servicios, sin repetir', () => {
    const result = deriveModalities([
      { modalities: [ServiceModality.on_site, ServiceModality.at_home] },
      { modalities: [ServiceModality.at_home] },
      { modalities: [ServiceModality.online] },
    ])
    expect(result).toEqual([
      ServiceModality.on_site,
      ServiceModality.at_home,
      ServiceModality.online,
    ])
  })

  // Es el agujero que marcó el spec: si alguien queda en on_site a secas, un
  // servicio online-only se queda sin nadie que lo dé y el negocio no se entera.
  it('un servicio online-only da alguien que atiende online y NADA más', () => {
    expect(deriveModalities([{ modalities: [ServiceModality.online] }])).toEqual([
      ServiceModality.online,
    ])
  })

  it('devuelve el orden canónico, no el de llegada', () => {
    const result = deriveModalities([
      { modalities: [ServiceModality.online] },
      { modalities: [ServiceModality.on_site] },
    ])
    expect(result).toEqual([ServiceModality.on_site, ServiceModality.online])
  })

  // Un servicio con la lista vacía es un dato corrupto (el schema de Zod no lo
  // permite). Que no arrastre a la persona a un estado igual de inútil.
  it('un servicio con lista vacía no deja a la persona sin ninguna modalidad', () => {
    expect(deriveModalities([{ modalities: [] }])).toEqual([ServiceModality.on_site])
  })
})

describe('createProfessionalSchema', () => {
  it('acepta lo mínimo: un nombre', () => {
    expect(createProfessionalSchema.safeParse({ name: 'Juan' }).success).toBe(true)
  })

  it('rechaza un nombre vacío o de sólo espacios', () => {
    expect(createProfessionalSchema.safeParse({ name: '' }).success).toBe(false)
    expect(createProfessionalSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('recorta el nombre', () => {
    expect(createProfessionalSchema.parse({ name: '  Juan  ' }).name).toBe('Juan')
  })

  it('rechaza un nombre de más de 100 caracteres', () => {
    expect(createProfessionalSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false)
  })

  it('rechaza una bio de más de 500 caracteres', () => {
    expect(
      createProfessionalSchema.safeParse({ name: 'Juan', bio: 'x'.repeat(501) }).success,
    ).toBe(false)
  })

  // Mismo motivo que en los servicios: el formulario manda checkboxes, y dos
  // clicks rápidos no deben persistir ['at_home','at_home'] y hacer que el picker
  // muestre la opción repetida.
  it('deduplica las modalidades conservando el orden canónico', () => {
    const parsed = createProfessionalSchema.parse({
      name: 'Juan',
      modalities: ['at_home', 'at_home', 'on_site'],
    })
    expect(parsed.modalities).toEqual([ServiceModality.on_site, ServiceModality.at_home])
  })

  it('rechaza una lista de modalidades vacía', () => {
    expect(
      createProfessionalSchema.safeParse({ name: 'Juan', modalities: [] }).success,
    ).toBe(false)
  })

  // Sin default a propósito: cuando no vienen, el servidor las deriva de los
  // servicios (deriveModalities). Un `.default([on_site])` acá se comería esa
  // derivación y dejaría un servicio online-only sin nadie que lo dé.
  it('deja modalities indefinido cuando no viene, para que el servidor lo derive', () => {
    expect(createProfessionalSchema.parse({ name: 'Juan' }).modalities).toBeUndefined()
  })

  it('deduplica los serviceIds', () => {
    const parsed = createProfessionalSchema.parse({
      name: 'Juan',
      serviceIds: ['svc-1', 'svc-1', 'svc-2'],
    })
    expect(parsed.serviceIds).toEqual(['svc-1', 'svc-2'])
  })

  // El businessId lo pone la sesión, nunca el payload. Si se colara, un negocio
  // podría dar de alta gente en otro.
  it('descarta las claves que no están en el schema', () => {
    const parsed = createProfessionalSchema.parse({
      name: 'Juan',
      businessId: 'otro-negocio',
      isActive: false,
      sortOrder: 99,
    })
    expect(parsed).not.toHaveProperty('businessId')
    expect(parsed).not.toHaveProperty('isActive')
    expect(parsed).not.toHaveProperty('sortOrder')
  })
})

describe('updateProfessionalSchema', () => {
  it('acepta un payload parcial', () => {
    expect(updateProfessionalSchema.safeParse({ bio: 'Corte clásico' }).success).toBe(true)
  })

  // Vacío es válido acá y lo rechaza la action, que es quien sabe que un update
  // sin campos no tiene sentido. El schema sólo valida forma.
  it('acepta un payload vacío', () => {
    expect(updateProfessionalSchema.safeParse({}).success).toBe(true)
  })

  it('sigue validando el nombre cuando viene', () => {
    expect(updateProfessionalSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('acepta una lista de servicios vacía, que es "no hace ninguno"', () => {
    const parsed = updateProfessionalSchema.parse({ serviceIds: [] })
    expect(parsed.serviceIds).toEqual([])
  })
})
