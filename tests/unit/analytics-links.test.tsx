import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AcquisitionLinks } from '@/components/dashboard/analytics/acquisition-links'
import type { OwnerAnalyticsReport } from '@/server/analytics/reports'

const links = {
  rows: [{ id: 'new-link', channel: 'instagram', campaignName: 'Nuevo sin tráfico', promotionId: null, createdAt: '2026-08-31T00:00:00.000Z', archivedAt: null, url: 'https://analytics.e2e.test/book?acq=opaque-token' }],
  page: 1,
  pageSize: 25,
  total: 1,
} satisfies OwnerAnalyticsReport['acquisitionLinks']

describe('AcquisitionLinks', () => {
  it('renders a manageable registry link even before an aggregate has traffic', () => {
    const markup = renderToStaticMarkup(<AcquisitionLinks links={links} />)

    expect(markup).toContain('Nuevo sin tráfico')
    expect(markup).toContain('https://analytics.e2e.test/book?acq=opaque-token')
    expect(markup).toContain('Copiar Nuevo sin tráfico')
  })
})
