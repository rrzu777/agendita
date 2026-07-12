import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BlockFormFields } from '@/components/dashboard/block-form-fields'

describe('BlockFormFields', () => {
  it('renderiza los 4 campos con los valores dados', () => {
    const html = renderToStaticMarkup(
      <BlockFormFields
        date="2026-06-01"
        onDateChange={() => {}}
        startTime="13:00"
        onStartTimeChange={() => {}}
        endTime="14:00"
        onEndTimeChange={() => {}}
        reason="Almuerzo"
        onReasonChange={() => {}}
      />,
    )
    expect(html).toContain('value="2026-06-01"')
    expect(html).toContain('aria-label="Hora inicio"')
    expect(html).toContain('13:00')
    expect(html).toContain('aria-label="Hora fin"')
    expect(html).toContain('14:00')
    expect(html).toContain('value="Almuerzo"')
    // Sin handler de tolerancia, el campo no aparece
    expect(html).not.toContain('block-overlap-tolerance')
  })

  it('renderiza el campo de tolerancia cuando se pasa el handler', () => {
    const html = renderToStaticMarkup(
      <BlockFormFields
        date="2026-06-01"
        onDateChange={() => {}}
        startTime="13:00"
        onStartTimeChange={() => {}}
        endTime="14:00"
        onEndTimeChange={() => {}}
        reason="Almuerzo"
        onReasonChange={() => {}}
        overlapTolerance="45"
        onOverlapToleranceChange={() => {}}
      />,
    )
    expect(html).toContain('block-overlap-tolerance')
    expect(html).toContain('value="45"')
    expect(html).toContain('invada')
  })
})
