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
    expect(html).toContain('aria-label="Hora inicio hora"')
    expect(html).toContain('value="13" selected=""')
    expect(html).toContain('aria-label="Hora fin hora"')
    expect(html).toContain('value="14" selected=""')
    expect(html).toContain('value="Almuerzo"')
  })
})
