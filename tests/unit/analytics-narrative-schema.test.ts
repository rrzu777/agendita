import { describe, expect, it } from 'vitest'
import { validateWeeklyNarrative, weeklyNarrativeSchema } from '@/server/analytics/weekly-insights/narrative-schema'

describe('weekly narrative schema', () => {
  it('accepts bounded findings that reference frozen facts/actions', () => {
    const value = validateWeeklyNarrative({ summary: 'Revisa la disponibilidad.', findings: [{ factId: 'availability_empty_over_30_percent', actionId: 'review_availability', statement: 'Hubo búsquedas sin horarios.' }], caveats: ['coverage_complete'] }, new Set(['availability_empty_over_30_percent']), new Set(['review_availability']))
    expect(value.findings).toHaveLength(1)
  })

  it('rejects extra fields, oversized output and unknown references', () => {
    expect(() => weeklyNarrativeSchema.parse({ summary: 'ok', findings: [], caveats: [], extra: 'no' })).toThrow()
    expect(() => validateWeeklyNarrative({ summary: 'ok', findings: [{ factId: 'unknown', actionId: 'review_availability', statement: 'x' }], caveats: [] }, new Set(), new Set(['review_availability']))).toThrow('narrative_invalid_reference')
    expect(() => weeklyNarrativeSchema.parse({ summary: 'x'.repeat(321), findings: [], caveats: [] })).toThrow()
  })
})
