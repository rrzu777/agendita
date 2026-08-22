import { renderToStaticMarkup } from 'react-dom/server'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ServiceModality } from '@prisma/client'
import { ServiceForm } from '@/components/dashboard/service-form'
import { ProfessionalForm } from '@/components/dashboard/professional-form'
import { renderWithVocabulary } from '../helpers/vocabulary'

vi.mock('@/server/actions/services', () => ({
  createService: vi.fn(),
  updateService: vi.fn(),
}))

vi.mock('@/server/actions/professionals', () => ({
  createProfessional: vi.fn(),
  updateProfessional: vi.fn(),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: PropsWithChildren) => <div data-slot="dialog">{children}</div>,
  DialogTrigger: ({ children }: PropsWithChildren) => <div data-slot="dialog-trigger">{children}</div>,
  DialogContent: ({ children }: PropsWithChildren) => <div data-slot="dialog-content">{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div data-slot="dialog-header">{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}))

const SERVICES = [
  { id: 'service-1', name: 'Manicura', modalities: [ServiceModality.on_site] },
]

function renderService(service: Parameters<typeof ServiceForm>[0]['service'] = null) {
  return renderToStaticMarkup(
    <ServiceForm service={service} currency="CLP" triggerLabel="Nuevo servicio" />,
  )
}

function renderProfessional() {
  return renderWithVocabulary(
    'nails',
    <ProfessionalForm services={SERVICES} />,
  )
}

describe('dashboard catalog form system', () => {
  it('uses semantic form fields and densities in the service dialog', () => {
    const markup = renderService()

    expect(markup.match(/data-slot="form-field"/g) ?? []).toHaveLength(7)
    expect(markup.match(/data-density="form"/g) ?? []).toHaveLength(7)
    expect(markup).not.toContain('studio-input')
    expect(markup).toContain('data-size="form"')
    expect(markup).toMatch(/<fieldset[^>]*aria-describedby="[^"]+"/)
    expect(markup).toContain('<legend')
    expect(markup).toContain('¿Dónde se atiende?')
    expect(markup).toContain('aria-label="Seleccionar color #FFB3BA"')
    expect(markup).toContain('aria-pressed="true"')
  })

  it('uses semantic fields and grouped choices in the professional dialog', () => {
    const markup = renderProfessional()

    expect(markup.match(/data-slot="form-field"/g) ?? []).toHaveLength(2)
    expect(markup.match(/data-density="form"/g) ?? []).toHaveLength(2)
    expect(markup).not.toContain('studio-input')
    expect(markup).toContain('data-size="form"')
    expect(markup.match(/<fieldset/g)).toHaveLength(2)
    expect(markup).toContain('<legend')
    expect(markup).toContain('¿Qué servicios hace?')
    expect(markup).toContain('¿Dónde atiende?')
  })

  it('keeps table edit triggers compact while form submits use form density', () => {
    const markup = renderService({
      id: 'service-1',
      name: 'Manicura',
      description: null,
      durationMinutes: 60,
      price: 15000,
      depositAmount: 5000,
      pastelColor: '#FFB3BA',
      modalities: [ServiceModality.on_site],
      isActive: true,
      sortOrder: 0,
    })

    expect(markup).toMatch(/data-slot="dialog-trigger"[^]*data-size="sm"/)
    expect(markup).toMatch(/<button[^>]*data-size="form"[^>]*type="submit"/)
  })
})
