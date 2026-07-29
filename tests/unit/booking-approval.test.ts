import { describe, it, expect } from 'vitest'
import { addHours, addMinutes } from 'date-fns'
import {
  initialPublicBookingStatus,
  approvalHoldExpiresAt,
  isHeldStatus,
  APPROVAL_WINDOW_HOURS,
  HELD_STATUSES,
} from '@/lib/bookings/approval'
import { recomputeBookingAmountsAfterDiscount } from '@/lib/booking/recompute'
import { generateSlots } from '@/lib/availability/slots'

const NOW = new Date('2028-03-01T12:00:00Z')

describe('initialPublicBookingStatus', () => {
  it('sin abono y sin confirmación manual: se auto-confirma (comportamiento actual)', () => {
    expect(initialPublicBookingStatus({ depositRequired: 0, requireBookingApproval: false }))
      .toBe('confirmed')
  })

  it('sin abono y con confirmación manual: queda esperando el visto bueno', () => {
    expect(initialPublicBookingStatus({ depositRequired: 0, requireBookingApproval: true }))
      .toBe('pending_confirmation')
  })

  it('con abono manda el cobro, aunque el negocio pida confirmación manual', () => {
    // El abono ya es el filtro; aprobar DESPUÉS de cobrar obligaría a devolver plata.
    expect(initialPublicBookingStatus({ depositRequired: 10000, requireBookingApproval: true }))
      .toBe('pending_payment')
  })
})

describe('approvalHoldExpiresAt', () => {
  it('usa la ventana de respuesta cuando la cita es lejana', () => {
    const start = addHours(NOW, 72)
    expect(approvalHoldExpiresAt(start, NOW)).toEqual(addHours(NOW, APPROVAL_WINDOW_HOURS))
  })

  it('no pasa de la hora de la cita: una solicitud no sigue viva después de la cita', () => {
    const start = addHours(NOW, 3)
    expect(approvalHoldExpiresAt(start, NOW)).toEqual(start)
  })
})

describe('isHeldStatus', () => {
  it('cubre los dos estados que ocupan cupo sólo mientras el hold viva', () => {
    expect(HELD_STATUSES).toEqual(['pending_payment', 'pending_confirmation'])
    expect(isHeldStatus('pending_confirmation')).toBe(true)
    expect(isHeldStatus('confirmed')).toBe(false)
  })
})

describe('recomputeBookingAmountsAfterDiscount + confirmación manual', () => {
  it('un descuento que deja el abono en 0 NO saltea la aprobación', () => {
    const start = addHours(NOW, 72)
    const result = recomputeBookingAmountsAfterDiscount({
      price: 20000,
      depositAmount: 10000,
      discountAmount: 20000, // servicio gratis: el abono queda en 0
      now: NOW,
      approval: { requireBookingApproval: true, startDateTime: start },
    })
    expect(result.status).toBe('pending_confirmation')
    expect(result.holdExpiresAt).toEqual(addHours(NOW, APPROVAL_WINDOW_HOURS))
    // El monto sigue derivándose igual: gratis se marca pagado.
    expect(result.paymentStatus).toBe('fully_paid')
  })

  it('sin confirmación manual el mismo descuento auto-confirma, como antes', () => {
    const result = recomputeBookingAmountsAfterDiscount({
      price: 20000, depositAmount: 10000, discountAmount: 20000, now: NOW,
    })
    expect(result.status).toBe('confirmed')
    expect(result.holdExpiresAt).toBeNull()
  })

  it('si queda abono, la reserva sigue yendo a cobro y conserva su ventana larga', () => {
    const result = recomputeBookingAmountsAfterDiscount({
      price: 20000, depositAmount: 10000, discountAmount: 5000, now: NOW, holdMinutes: 1440,
      approval: { requireBookingApproval: true, startDateTime: addHours(NOW, 72) },
    })
    expect(result.status).toBe('pending_payment')
    expect(result.holdExpiresAt).toEqual(addMinutes(NOW, 1440))
  })
})

describe('generateSlots + solicitudes pendientes', () => {
  const rules = [{ dayOfWeek: 3, startTime: '09:00', endTime: '12:00', isActive: true }]
  // 2028-03-01 es miércoles. Horario local Santiago = UTC-3 en marzo.
  const day = new Date('2028-03-01T12:00:00Z')
  const bookingStart = new Date('2028-03-01T13:00:00Z') // 10:00 local
  const bookingEnd = new Date('2028-03-01T14:00:00Z')
  const opts = { timezone: 'America/Santiago', now: new Date('2028-02-28T12:00:00Z'), leadTimeMinutes: 0 }

  it('una solicitud con hold vivo tapa el horario', () => {
    const slots = generateSlots(day, 60, rules, [], [{
      startDateTime: bookingStart, endDateTime: bookingEnd,
      status: 'pending_confirmation', holdExpiresAt: new Date('2028-03-01T11:00:00Z'),
    }], opts)
    expect(slots.some((s) => s.start.getTime() === bookingStart.getTime())).toBe(false)
  })

  it('una solicitud con el hold vencido libera el horario aunque el cron no haya corrido', () => {
    const slots = generateSlots(day, 60, rules, [], [{
      startDateTime: bookingStart, endDateTime: bookingEnd,
      status: 'pending_confirmation', holdExpiresAt: new Date('2028-02-27T12:00:00Z'),
    }], opts)
    expect(slots.some((s) => s.start.getTime() === bookingStart.getTime())).toBe(true)
  })
})
