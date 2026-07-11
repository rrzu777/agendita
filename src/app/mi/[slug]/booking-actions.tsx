'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cancelMyBooking } from '@/server/actions/my-bookings'

export function BookingActions({
  bookingId,
  slug,
  canManage,
  cutoffHours,
}: {
  bookingId: string
  slug: string
  canManage: boolean
  cutoffHours: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')

  if (!canManage) {
    return (
      <p className="mt-1 text-xs text-gray-400">
        {cutoffHours === 0
          ? 'Esta reserva ya no se puede modificar.'
          : `Se puede cancelar o reprogramar hasta ${cutoffHours} horas antes. Para cambios de último minuto, contacta al negocio.`}
      </p>
    )
  }

  function handleCancel() {
    setError('')
    startTransition(async () => {
      try {
        await cancelMyBooking(bookingId)
        setConfirming(false)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo cancelar')
      }
    })
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
      {confirming ? (
        <>
          <span className="text-gray-600">¿Cancelar esta reserva?</span>
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className="font-semibold text-red-600 hover:underline disabled:opacity-50"
          >
            {pending ? 'Cancelando…' : 'Sí, cancelar'}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="text-gray-500 hover:underline">
            No
          </button>
        </>
      ) : (
        <>
          <Link href={`/mi/${slug}/reservas/${bookingId}/reprogramar`} className="font-semibold text-pink-700 hover:underline">
            Reprogramar
          </Link>
          <button type="button" onClick={() => setConfirming(true)} className="text-gray-500 hover:underline">
            Cancelar reserva
          </button>
        </>
      )}
      {error && <span className="w-full text-xs text-red-600">{error}</span>}
    </div>
  )
}
