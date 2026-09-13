import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FinanceStats } from '@/components/dashboard/finance-stats'

describe('FinanceStats copy', () => {
  it('describes unbounded booking counts as historical totals', () => {
    const html = renderToStaticMarkup(<FinanceStats summary={{
      incomeToday: 0, incomeMonth: 0, packageIncomeToday: 0, packageIncomeMonth: 0,
      totalDeposited: 0, totalPending: 0, totalBookings: 2, completedBookings: 1,
      cancelledBookings: 1, totalRefunded: 0,
    }} currency="CLP" />)

    expect(html.match(/Histórico del negocio/g)).toHaveLength(3)
    expect(html).not.toContain('Total del período')
  })
})
