import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRelease } = vi.hoisted(() => ({ mockRelease: vi.fn() }))
vi.mock('@/lib/promotions/release', () => ({ releaseRedemptionForBooking: mockRelease }))

const { mockAssertSlot } = vi.hoisted(() => ({ mockAssertSlot: vi.fn() }))
vi.mock('@/lib/availability/validation', () => ({ assertSlotIsAvailable: mockAssertSlot }))

import { BookingPaymentStatus, BookingStatus } from '@prisma/client'
import { cancelBookingInTx, rescheduleBookingInTx } from '@/lib/bookings/mutate'
import { anyDeclaredTransferWhere } from '@/lib/bank-transfer/declared'

function makeTx() {
  return {
    booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    payment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  }
}

describe('cancelBookingInTx', () => {
  beforeEach(() => vi.clearAllMocks())

  it('flip a cancelled (guardado por status) + release + cierra bt-declared pendiente', async () => {
    const tx = makeTx()
    await cancelBookingInTx(tx as never, { id: 'b1', internalNotes: 'nota' }, { reason: 'me enfermé' })
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: { notIn: ['completed', 'cancelled'] } },
      data: { status: 'cancelled', internalNotes: 'nota\n[CANCELADA: me enfermé]' },
    })
    expect(mockRelease).toHaveBeenCalledWith(tx, 'b1', 'cancelled')
    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: { bookingId: 'b1', ...anyDeclaredTransferWhere },
      data: { status: 'cancelled' },
    })
  })

  it('sin reason conserva internalNotes tal cual', async () => {
    const tx = makeTx()
    await cancelBookingInTx(tx as never, { id: 'b1', internalNotes: null }, {})
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: { notIn: ['completed', 'cancelled'] } },
      data: { status: 'cancelled', internalNotes: null },
    })
  })

  it('lanza si el updateMany no matchea (carrera: se completó entre el read y la tx) y no libera nada', async () => {
    const tx = makeTx()
    tx.booking.updateMany.mockResolvedValue({ count: 0 })
    await expect(cancelBookingInTx(tx as never, { id: 'b1', internalNotes: null }, {})).rejects.toThrow('No se puede cancelar')
    expect(mockRelease).not.toHaveBeenCalled()
    expect(tx.payment.updateMany).not.toHaveBeenCalled()
  })
})

describe('rescheduleBookingInTx', () => {
  beforeEach(() => vi.clearAllMocks())

  const baseInput = {
    booking: {
      id: 'b1', businessId: 'biz1', serviceId: 's1',
      startDateTime: new Date('2026-07-20T15:00:00Z'), internalNotes: null, professionalId: null,
      // Una reserva confirmada: sin plazo que pueda estar vencido. Los casos del
      // plazo lo pisan — ver el describe de abajo. Con los enums de Prisma y no
      // con literales sueltos: el tipo del core los exige, y un `as never` acá
      // apagaría el guard sin que el compilador chiste (ya pasó dos veces).
      status: BookingStatus.confirmed,
      paymentStatus: BookingPaymentStatus.deposit_paid,
      holdExpiresAt: null as Date | null,
      approvalExpiresAt: null as Date | null,
      createdAt: new Date('2026-07-19T12:00:00Z'),
    },
    newStartDateTime: new Date('2026-07-21T15:00:00Z'),
    durationMinutes: 60,
    timezone: 'America/Santiago',
    rescheduledBy: 'owner' as const,
  }

  it('valida slot y actualiza con guard de status', async () => {
    const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
    await rescheduleBookingInTx(tx as never, { ...baseInput, leadTimeMinutes: 0 })
    expect(mockAssertSlot).toHaveBeenCalledWith(expect.objectContaining({
      tx, businessId: 'biz1', serviceId: 's1',
      startDateTime: baseInput.newStartDateTime,
      endDateTime: new Date('2026-07-21T16:00:00Z'),
      excludeBookingId: 'b1', leadTimeMinutes: 0,
    }))
    expect(tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'b1', businessId: 'biz1' }),
      data: expect.objectContaining({
        startDateTime: baseInput.newStartDateTime,
        endDateTime: new Date('2026-07-21T16:00:00Z'),
        cancellationReminderClaimedAt: null,
        cancellationReminderSentAt: null,
      }),
    }))
    const data = tx.booking.updateMany.mock.calls[0][0].data
    expect(data).not.toHaveProperty('cancellationCutoffHours')
    expect(data).not.toHaveProperty('cancellationPolicySnapshot')
  })

  it('lanza si el updateMany no matchea (carrera de status)', async () => {
    const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } }
    await expect(rescheduleBookingInTx(tx as never, baseInput)).rejects.toThrow('No se puede reprogramar')
  })

  it('la nota REPROGRAMADA usa la fecha local del negocio, no la del server', async () => {
    // 2026-07-21T02:00:00Z = 2026-07-20 22:00 en Santiago (UTC-4). Con la TZ del
    // server (UTC) saldría "21-07"; con la del negocio, "20-07 22:00".
    const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
    await rescheduleBookingInTx(tx as never, {
      ...baseInput,
      booking: { ...baseInput.booking, startDateTime: new Date('2026-07-21T02:00:00Z'), internalNotes: null, professionalId: null },
      leadTimeMinutes: 0,
    })
    expect(tx.booking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ internalNotes: '[REPROGRAMADA de 20-07-2026 22:00]' }),
    }))
  })

  // Mover la cita no reescribe `holdExpiresAt`, así que el cron la barre igual:
  // la reprogramación salía bien, avisaba a las dos partes, y una hora después
  // la reserva no estaba.
  describe('plazo vencido', () => {
    const condenada = {
      ...baseInput.booking,
      status: BookingStatus.pending_payment,
      paymentStatus: BookingPaymentStatus.unpaid,
      holdExpiresAt: new Date(Date.now() - 60_000) as Date | null,
    }

    it('no reprograma una reserva que el cron va a barrer, y ni siquiera mira el cupo', async () => {
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
      await expect(
        rescheduleBookingInTx(tx as never, { ...baseInput, booking: condenada }),
      ).rejects.toThrow('Venció el plazo de esta reserva')
      // Corta ANTES del cupo: sin esto la reserva se movía de verdad.
      expect(mockAssertSlot).not.toHaveBeenCalled()
      expect(tx.booking.updateMany).not.toHaveBeenCalled()
    })

    it('el mensaje es el de la audiencia: la clienta no tiene Revivir', async () => {
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
      await expect(
        rescheduleBookingInTx(tx as never, {
          ...baseInput, booking: condenada, rescheduledBy: 'customer',
        }),
      ).rejects.toThrow('Contactá al negocio')
    })

    // La solicitud sin responder también la barre el cron, pero por el OTRO
    // sweep: ahí la dueña todavía puede Aceptar —y aceptar limpia el plazo—, así
    // que mandarla a esperar el Revivir sería nombrarle una salida que no es.
    it('la solicitud sin responder nombra Aceptar, no Revivir', async () => {
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
      await expect(
        rescheduleBookingInTx(tx as never, {
          ...baseInput,
          booking: {
            ...condenada,
            status: BookingStatus.pending_confirmation,
            paymentStatus: BookingPaymentStatus.fully_paid,
            holdExpiresAt: null,
            approvalExpiresAt: condenada.holdExpiresAt,
          },
        }),
      ).rejects.toThrow(/aceptala/i)
    })

    // Y del lado de la clienta ese plazo NO era suyo: una solicitud sobre un
    // servicio gratis nace `fully_paid` y acusarla de no haber pagado es falso.
    it('a la clienta, la solicitud vencida no le echa la culpa del pago', async () => {
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
      await expect(
        rescheduleBookingInTx(tx as never, {
          ...baseInput,
          booking: {
            ...condenada,
            status: BookingStatus.pending_confirmation,
            paymentStatus: BookingPaymentStatus.fully_paid,
            holdExpiresAt: null,
            approvalExpiresAt: condenada.holdExpiresAt,
          },
          rescheduledBy: 'customer',
        }),
      ).rejects.toThrow('El negocio no respondió esta solicitud a tiempo')
    })

    it('con plata adentro NO bloquea: el cron tampoco la barre', async () => {
      // Mismo criterio que `assertBookingPayable`: el plazo vencido sólo condena
      // a la reserva que el sweep va a matar, y ésa filtra `unpaid`.
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
      await rescheduleBookingInTx(tx as never, {
        ...baseInput,
        booking: { ...condenada, paymentStatus: BookingPaymentStatus.deposit_paid },
      })
      expect(tx.booking.updateMany).toHaveBeenCalled()
    })

    it('con el plazo vivo reprograma normal', async () => {
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
      await rescheduleBookingInTx(tx as never, {
        ...baseInput,
        booking: { ...condenada, holdExpiresAt: new Date(Date.now() + 60 * 60_000) },
      })
      expect(tx.booking.updateMany).toHaveBeenCalled()
    })
  })

  // El plazo propio de la solicitud tiene la cita adentro
  // (`calculateApprovalExpiresAt` topa al ESCRIBIR).
  // Moverla y dejar el plazo quieto rompía ese dato en las dos direcciones.
  describe('recálculo del plazo de la solicitud', () => {
    // Relativas al reloj real a propósito: el guard de "plazo vencido" corre
    // antes que esto y con fechas fijas en el pasado tumbaría el caso entero.
    const h = (horas: number) => new Date(Date.now() + horas * 3_600_000)
    const NACIMIENTO = h(-1)
    const CITA_VIEJA = h(5)
    const solicitud = {
      ...baseInput.booking,
      status: BookingStatus.pending_confirmation,
      paymentStatus: BookingPaymentStatus.fully_paid,
      // Nació para una cita cercana, así que el tope se lo puso la CITA (5 h,
      // menos que las 24 de la ventana de respuesta).
      holdExpiresAt: null,
      approvalExpiresAt: CITA_VIEJA as Date | null,
      createdAt: NACIMIENTO,
      startDateTime: CITA_VIEJA,
    }

    async function reprogramarA(newStartDateTime: Date) {
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
      await rescheduleBookingInTx(tx as never, { ...baseInput, booking: solicitud, newStartDateTime })
      return tx.booking.updateMany.mock.calls[0][0].data.approvalExpiresAt
    }

    // Antes: el plazo se quedaba en la cita VIEJA y `expireUnansweredRequests`
    // mataba la solicitud esa tarde —con un mail diciéndole a la clienta "el
    // negocio no alcanzó a confirmar"— por una cita a dos semanas.
    it('con la cita lejos, el tope pasa a ser la ventana contada desde que nació', async () => {
      const hold = await reprogramarA(h(24 * 15))
      // 24 h desde el NACIMIENTO (o sea h(23)), no desde ahora: reprogramar no
      // le regala a la dueña una ventana nueva por cada movida.
      expect(hold).toEqual(new Date(NACIMIENTO.getTime() + 24 * 3_600_000))
    })

    // Mover para adelante NO significa "ventana entera": sigue siendo un min().
    // Con la cita todavía adentro de la ventana, el tope se lo lleva la cita.
    it('mover para adelante pero dentro de la ventana sigue topando en la cita', async () => {
      const nuevaCita = h(8)
      expect(await reprogramarA(nuevaCita)).toEqual(nuevaCita)
    })

    // Antes: el plazo quedaba DESPUÉS de la cita y la solicitud seguía ocupando
    // el horario pasada su propia hora — justo lo que el tope existe para evitar.
    it('mover para atrás vuelve a topar en la cita', async () => {
      const nuevaCita = h(2)
      expect(await reprogramarA(nuevaCita)).toEqual(nuevaCita)
    })

    // El plazo de la clienta cuenta desde que se abrió el checkout y no sabe
    // nada del turno: mover la cita no compra más tiempo para pagar.
    it('el plazo para PAGAR no se toca', async () => {
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
      await rescheduleBookingInTx(tx as never, {
        ...baseInput,
        booking: {
          ...solicitud,
          status: BookingStatus.pending_payment,
          paymentStatus: BookingPaymentStatus.unpaid,
          holdExpiresAt: h(0.25),
          approvalExpiresAt: null,
        },
        newStartDateTime: h(24 * 15),
      })
      expect(tx.booking.updateMany.mock.calls[0][0].data).not.toHaveProperty('holdExpiresAt')
      expect(tx.booking.updateMany.mock.calls[0][0].data).not.toHaveProperty('approvalExpiresAt')
    })

    it('una reserva confirmada tampoco estrena plazo', async () => {
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
      await rescheduleBookingInTx(tx as never, { ...baseInput, leadTimeMinutes: 0 })
      expect(tx.booking.updateMany.mock.calls[0][0].data).not.toHaveProperty('approvalExpiresAt')
    })

    // El status se leyó FUERA de la tx. Si la dueña acepta la solicitud en el
    // medio queda `confirmed` y con el plazo en `null`; sin fijar el status, el
    // update pasaba igual (confirmed no es terminal) y le devolvía un plazo
    // futuro a una reserva ya confirmada.
    it('el update queda fijado al status del que cuelga el plazo', async () => {
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
      await rescheduleBookingInTx(tx as never, {
        ...baseInput, booking: solicitud, newStartDateTime: h(24 * 15),
      })
      expect(tx.booking.updateMany.mock.calls[0][0].where.status).toBe('pending_confirmation')
    })

    it('sin plazo que escribir, el update conserva el guard ancho de siempre', async () => {
      const tx = { booking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
      await rescheduleBookingInTx(tx as never, { ...baseInput, leadTimeMinutes: 0 })
      expect(tx.booking.updateMany.mock.calls[0][0].where.status).toEqual({
        notIn: ['completed', 'cancelled', 'no_show', 'expired'],
      })
    })
  })
})
