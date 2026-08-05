import { describe, it, expect } from 'vitest'
import { addHours, addMinutes } from 'date-fns'
import {
  initialPublicBookingStatus,
  calculateApprovalExpiresAt,
  occupiesSlot,
  isSweepableExpiredHold,
  APPROVAL_WINDOW_HOURS,
  OCCUPYING_STATUSES,
  NO_OVERLAP_STATUSES,
} from '@/lib/bookings/approval'
import { recomputeBookingAmountsAfterDiscount } from '@/lib/bookings/recompute'
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

describe('calculateApprovalExpiresAt', () => {
  it('usa la ventana de respuesta cuando la cita es lejana', () => {
    const start = addHours(NOW, 72)
    expect(calculateApprovalExpiresAt(start, NOW)).toEqual(addHours(NOW, APPROVAL_WINDOW_HOURS))
  })

  it('no pasa de la hora de la cita: una solicitud no sigue viva después de la cita', () => {
    const start = addHours(NOW, 3)
    expect(calculateApprovalExpiresAt(start, NOW)).toEqual(start)
  })
})

describe('las listas de estados', () => {
  it('una solicitud ocupa el cupo hasta que el cron asienta su expiración', () => {
    expect(OCCUPYING_STATUSES).toContain('pending_confirmation')
  })

  // La copia TS del WHERE del EXCLUDE. Contra la definición REAL de Postgres la
  // compara el test de integración booking-overlap-constraint; acá sólo fijamos
  // que sean los cuatro activos y ninguno más.
  it('NO_OVERLAP_STATUSES son los cuatro estados activos', () => {
    expect([...NO_OVERLAP_STATUSES].sort()).toEqual(
      ['completed', 'confirmed', 'pending_confirmation', 'pending_payment'],
    )
  })
})

describe('occupiesSlot / isSweepableExpiredHold', () => {
  const VENCIDO = new Date('2028-03-01T11:00:00Z')
  const VIVO = new Date('2028-03-01T13:00:00Z')
  /** Hold de pago vencido y abandonado: el caso que el sweep sí puede barrer. */
  const abandonado = {
    status: 'pending_payment' as string,
    holdExpiresAt: VENCIDO,
    paymentStatus: 'unpaid',
    paymentMethod: null as string | null,
  }

  it('un hold de pago abandonado libera el horario y es barrible', () => {
    expect(occupiesSlot(abandonado, NOW)).toBe(false)
    expect(isSweepableExpiredHold(abandonado, NOW)).toBe(true)
  })

  it('con el hold vivo tapa el horario y NO es barrible', () => {
    const vivo = { ...abandonado, holdExpiresAt: VIVO }
    expect(occupiesSlot(vivo, NOW)).toBe(true)
    expect(isSweepableExpiredHold(vivo, NOW)).toBe(false)
  })

  it('sin holdExpiresAt tapa el horario: no hay vencimiento que lo libere', () => {
    const sinHold = { ...abandonado, holdExpiresAt: null }
    expect(occupiesSlot(sinHold, NOW)).toBe(true)
    expect(isSweepableExpiredHold(sinHold, NOW)).toBe(false)
  })

  // Las dos familias que ningún sweep puede tocar: para el EXCLUDE
  // Booking_no_overlap siguen ocupando el horario, así que la app también.
  it('con plata encima sigue tapando aunque el hold haya vencido', () => {
    const conPlata = { ...abandonado, paymentStatus: 'deposit_paid' }
    expect(occupiesSlot(conPlata, NOW)).toBe(true)
    expect(isSweepableExpiredHold(conPlata, NOW)).toBe(false)
  })

  it('con transferencia bancaria sigue tapando: la barre el cron, con aviso', () => {
    const transferencia = { ...abandonado, paymentMethod: 'bank_transfer' }
    expect(occupiesSlot(transferencia, NOW)).toBe(true)
    expect(isSweepableExpiredHold(transferencia, NOW)).toBe(false)
  })

  // Mismo trato que la transferencia y por el mismo motivo: a esta clienta la
  // pantalla le prometió "el negocio te contacta" y el único que le avisa que
  // la ventana venció es el cron. El sweep silencioso la dejaría esperando.
  it('con coordinación manual sigue tapando: la barre el cron, con aviso', () => {
    const manual = { ...abandonado, paymentMethod: 'manual' }
    expect(occupiesSlot(manual, NOW)).toBe(true)
    expect(isSweepableExpiredHold(manual, NOW)).toBe(false)
  })

  it('sin paymentStatus tapa el horario: un caller que no trajo el campo no decide', () => {
    const sinCampo = { status: abandonado.status, holdExpiresAt: abandonado.holdExpiresAt }
    expect(occupiesSlot(sinCampo, NOW)).toBe(true)
    expect(isSweepableExpiredHold(sinCampo, NOW)).toBe(false)
  })

  // Antes liberaba al instante. Desde `booking_overlap_solicitudes` el EXCLUDE
  // cubre `pending_confirmation`, así que darla por libre acá ofrecería una hora
  // que el insert rechaza. Y no es asunto del sweep de pagos: expirarla le manda
  // un mail a la clienta, y de eso se encarga el cron.
  it('una solicitud vencida sigue tapando hasta que el cron la expire', () => {
    const solicitud = { status: 'pending_confirmation', approvalExpiresAt: VENCIDO }
    expect(occupiesSlot(solicitud, NOW)).toBe(true)
    expect(isSweepableExpiredHold(solicitud, NOW)).toBe(false)
  })

  it('los estados terminales no ocupan y los vivos sí', () => {
    for (const status of ['cancelled', 'no_show', 'expired']) {
      expect(occupiesSlot({ status }, NOW)).toBe(false)
    }
    for (const status of ['confirmed', 'completed']) {
      expect(occupiesSlot({ status }, NOW)).toBe(true)
    }
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
    expect(result.holdExpiresAt).toBeNull()
    expect(result.approvalExpiresAt).toEqual(addHours(NOW, APPROVAL_WINDOW_HOURS))
    // El monto sigue derivándose igual: gratis se marca pagado.
    expect(result.paymentStatus).toBe('fully_paid')
  })

  it('sin confirmación manual el mismo descuento auto-confirma, como antes', () => {
    const result = recomputeBookingAmountsAfterDiscount({
      price: 20000, depositAmount: 10000, discountAmount: 20000, now: NOW,
    })
    expect(result.status).toBe('confirmed')
    expect(result.holdExpiresAt).toBeNull()
    expect(result.approvalExpiresAt).toBeNull()
  })

  it('si queda abono, la reserva sigue yendo a cobro y conserva su ventana larga', () => {
    const result = recomputeBookingAmountsAfterDiscount({
      price: 20000, depositAmount: 10000, discountAmount: 5000, now: NOW, holdMinutes: 1440,
      approval: { requireBookingApproval: true, startDateTime: addHours(NOW, 72) },
    })
    expect(result.status).toBe('pending_payment')
    expect(result.holdExpiresAt).toEqual(addMinutes(NOW, 1440))
    expect(result.approvalExpiresAt).toBeNull()
  })
})

describe('generateSlots + solicitudes pendientes', () => {
  const rules = [{ dayOfWeek: 3, startTime: '09:00', endTime: '12:00', isActive: true }]
  // 2028-03-01 es miércoles. Horario local Santiago = UTC-3 en marzo.
  const day = new Date('2028-03-01T12:00:00Z')
  const bookingStart = new Date('2028-03-01T13:00:00Z') // 10:00 local
  const bookingEnd = new Date('2028-03-01T14:00:00Z')
  const opts = { timezone: 'America/Santiago', now: new Date('2028-02-28T12:00:00Z'), leadTimeMinutes: 0 }

  it('una solicitud con plazo de aprobación vivo tapa el horario', () => {
    const slots = generateSlots(day, 60, rules, [], [{
      startDateTime: bookingStart, endDateTime: bookingEnd,
      status: 'pending_confirmation', approvalExpiresAt: new Date('2028-03-01T11:00:00Z'),
    }], opts)
    expect(slots.some((s) => s.start.getTime() === bookingStart.getTime())).toBe(false)
  })

  // La agenda no puede ofrecer un horario que el EXCLUDE va a rechazar, y desde
  // `booking_overlap_solicitudes` la fila sigue contando mientras diga
  // `pending_confirmation`. El horario se libera cuando el cron la expira —y de
  // paso le avisa por mail a la clienta que nadie le respondió.
  it('una solicitud con el plazo vencido no libera el horario hasta que corre el cron', () => {
    const slots = generateSlots(day, 60, rules, [], [{
      startDateTime: bookingStart, endDateTime: bookingEnd,
      status: 'pending_confirmation', approvalExpiresAt: new Date('2028-02-27T12:00:00Z'),
    }], opts)
    expect(slots.some((s) => s.start.getTime() === bookingStart.getTime())).toBe(false)
  })

  it('una solicitud ya expirada por el cron sí libera el horario', () => {
    const slots = generateSlots(day, 60, rules, [], [{
      startDateTime: bookingStart, endDateTime: bookingEnd,
      status: 'expired', holdExpiresAt: new Date('2028-02-27T12:00:00Z'),
    }], opts)
    expect(slots.some((s) => s.start.getTime() === bookingStart.getTime())).toBe(true)
  })

  // La agenda no puede ofrecer un horario que el EXCLUDE Booking_no_overlap va a
  // rechazar: la reserva sigue `pending_payment`, con plata que nadie va a barrer.
  it('un hold de pago vencido CON plata encima no libera el horario', () => {
    const slots = generateSlots(day, 60, rules, [], [{
      startDateTime: bookingStart, endDateTime: bookingEnd,
      status: 'pending_payment', holdExpiresAt: new Date('2028-02-27T12:00:00Z'),
      paymentStatus: 'deposit_paid', paymentMethod: null,
    }], opts)
    expect(slots.some((s) => s.start.getTime() === bookingStart.getTime())).toBe(false)
  })

  it('un checkout abandonado sin plata sí libera el horario', () => {
    const slots = generateSlots(day, 60, rules, [], [{
      startDateTime: bookingStart, endDateTime: bookingEnd,
      status: 'pending_payment', holdExpiresAt: new Date('2028-02-27T12:00:00Z'),
      paymentStatus: 'unpaid', paymentMethod: null,
    }], opts)
    expect(slots.some((s) => s.start.getTime() === bookingStart.getTime())).toBe(true)
  })
})
