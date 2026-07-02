import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecurrenceFields } from '@/components/dashboard/recurrence-fields'

describe('RecurrenceFields', () => {
  it('oculta los controles cuando no es recurrente', () => {
    const html = renderToStaticMarkup(
      <RecurrenceFields recurring={false} onRecurringChange={() => {}} daysOfWeek={[]} onDaysOfWeekChange={() => {}} endMode="forever" onEndModeChange={() => {}} weeks={3} onWeeksChange={() => {}} />,
    )
    expect(html).toContain('Repetir')
    expect(html).not.toContain('Días de la semana')
  })

  it('muestra días y opciones de fin cuando es recurrente', () => {
    const html = renderToStaticMarkup(
      <RecurrenceFields recurring={true} onRecurringChange={() => {}} daysOfWeek={[1, 2]} onDaysOfWeekChange={() => {}} endMode="weeks" onEndModeChange={() => {}} weeks={3} onWeeksChange={() => {}} />,
    )
    expect(html).toContain('Días de la semana')
    expect(html).toContain('Para siempre')
  })
})
