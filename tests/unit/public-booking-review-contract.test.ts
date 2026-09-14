import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const read = (path: string) => fs.readFileSync(path, 'utf8')

describe('public booking review contract', () => {
  it('keeps recovery targets touch sized and copy in es-CL tuteo', () => {
    const files = [read('src/components/booking/wizard.tsx'), read('src/components/booking/step-customer.tsx'), read('src/components/booking/step-professional.tsx'), read('src/components/booking/step-payment.tsx'), read('src/app/book/confirmation/page.tsx')].join('\n')
    for (const voseo of ['revisá', 'Transferí', 'podés', 'querés', 'contactá', 'escribile']) expect(files).not.toContain(voseo)
    expect(files).not.toContain('confirmación por WhatsApp')
    expect(files).not.toContain('te llega la confirmación')
    expect(files).toContain('vuelve a esta página para revisar el estado')
    for (const label of ['No soy yo', 'Reintentar consulta', 'Cambiar profesional', 'Volver a seleccionar horario']) {
      expect(files.split('\n').find(value => value.includes(label) && value.includes('className')), label).toMatch(/min-h-11|size="touch"|h-12/)
    }
  })

  it('shares loading geometry, protects safe area and keeps functional progress at 12px', () => {
    expect(read('src/app/book/loading.tsx')).toContain('BookingRouteLoading')
    expect(read('src/app/book/[slug]/loading.tsx')).toContain('BookingRouteLoading')
    expect(read('src/app/b/[slug]/loading.tsx')).toContain('max-w-5xl')
    expect(read('src/components/public/business-profile.tsx')).toContain('safe-area-inset-bottom')
    expect(read('src/app/layout.tsx')).toContain('viewportFit: "cover"')
    expect(read('src/components/booking/booking-progress.tsx')).not.toContain('text-[10px]')
    expect(read('src/components/booking/step-customer.tsx')).toMatch(/Textarea id="booking-customer-notes" className="resize-none"/)
  })
})
