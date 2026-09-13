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
  serviceId: string | string[] | null | undefined,
) {
  type Preview = { remaining: number; discountAmount?: number; depositRequired?: number; coveredServiceName?: string }
  const selectionKey = JSON.stringify(serviceId)
  const key = JSON.stringify([businessId, phone, selectionKey])
  const [result, setResult] = useState<{ key: string; data: Preview } | null>(null)
  const [usePackage, setUsePackage] = useState(true)

  useEffect(() => {
    if (!phone || !serviceId) {
      return
    }
    let cancelled = false
    getActivePackagesForCustomer({ businessId, phone, ...(Array.isArray(serviceId) ? { serviceIds: serviceId } : { serviceId }) })
      .then((res) => { if (!cancelled) setResult({ key, data: res.ok ? res.data : { remaining: 0 } }) })
      .catch(() => { if (!cancelled) setResult({ key, data: { remaining: 0 } }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable key carries the complete selection.
  }, [key])

  const preview = result?.key === key ? result.data : { remaining: 0 }
  // Never opt into an economic effect that has not been shown for this selection.
  return { ...preview, usePackage: usePackage && preview.remaining > 0, setUsePackage }
}
