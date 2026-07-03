'use client'

import { useEffect, useState } from 'react'
import { getActivePackagesForCustomer } from '@/server/actions/packages'

/**
 * Sesiones de paquete prepago que cubren un servicio para una clienta (por teléfono).
 * Consulta reactiva NO autoritativa: el servidor aplica el paquete dentro de la
 * transacción de reserva; esto es solo para ofrecer el toggle en la UI.
 *
 * Reset del `remaining` stale cuando falta teléfono/servicio, con un flag `cancelled`
 * para descartar respuestas de una consulta previa. Devuelve el conteo y el toggle
 * `usePackage` (default on). Compartido entre el funnel público y el form manual.
 */
export function usePackageAvailability(
  businessId: string,
  phone: string | null | undefined,
  serviceId: string | null | undefined,
): { remaining: number; usePackage: boolean; setUsePackage: (v: boolean) => void } {
  const [remaining, setRemaining] = useState(0)
  const [usePackage, setUsePackage] = useState(true)

  /* eslint-disable react-hooks/set-state-in-effect -- reset stale remaining when
     phone/service is incomplete, guarded by deps so it can't cascade. */
  useEffect(() => {
    if (!phone || !serviceId) {
      setRemaining(0)
      return
    }
    let cancelled = false
    getActivePackagesForCustomer({ businessId, phone, serviceId })
      .then((res) => { if (!cancelled) setRemaining(res.remaining) })
      .catch(() => { if (!cancelled) setRemaining(0) })
    return () => { cancelled = true }
  }, [businessId, phone, serviceId])
  /* eslint-enable react-hooks/set-state-in-effect */

  return { remaining, usePackage, setUsePackage }
}
