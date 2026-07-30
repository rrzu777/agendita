import { describe, it, expect } from 'vitest'
import { ServiceModality } from '@prisma/client'
import { deriveModalities } from '@/lib/professionals/modalities'

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
