import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { EditSeriesOccurrenceDialog } from '@/components/dashboard/edit-series-occurrence-dialog'

describe('EditSeriesOccurrenceDialog', () => {
  it('renderiza sin lanzar', () => {
    const block = { id: 's1:2026-06-01', startDateTime: '2026-06-01T17:00:00.000Z', endDateTime: '2026-06-01T18:00:00.000Z', reason: 'Almuerzo', seriesId: 's1', occurrenceDate: '2026-06-01T04:00:00.000Z' }
    expect(() =>
      renderToStaticMarkup(<EditSeriesOccurrenceDialog block={block} timezone="America/Santiago" open={true} onOpenChange={() => {}} />),
    ).not.toThrow()
  })
})
