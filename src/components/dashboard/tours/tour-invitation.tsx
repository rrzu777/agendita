'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useDashboardTours } from './tour-context'

const INTRO_TOUR_KEY = 'dashboard_intro' as const

export function TourInvitation() {
  const { active, available, dismiss, offer, start } = useDashboardTours()
  const eligible = available.includes(INTRO_TOUR_KEY)

  useEffect(() => {
    if (eligible) void offer(INTRO_TOUR_KEY)
  }, [eligible, offer])

  if (!eligible || active) return null

  return (
    <section className="studio-card mb-8 border-border/60 bg-card p-5 md:p-6" aria-labelledby="tour-invitation-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="tour-invitation-title" className="text-lg font-semibold text-primary">
            Conoce Agendita en 2 minutos
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Te mostramos dónde encontrar lo esencial para administrar tu negocio.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" onClick={() => { void start(INTRO_TOUR_KEY) }}>
            Iniciar recorrido
          </Button>
          <Button type="button" variant="ghost" onClick={() => { void dismiss(INTRO_TOUR_KEY) }}>
            Ahora no
          </Button>
        </div>
      </div>
    </section>
  )
}
