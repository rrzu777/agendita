'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { disconnectMercadoPago } from '@/server/actions/mercado-pago-connect'
import { Link2Off, AlertCircle } from 'lucide-react'

export function DisconnectButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDisconnect() {
    setLoading(true)
    setError(null)
    try {
      const res = await disconnectMercadoPago()
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
    } catch {
      setError('Error al desconectar Mercado Pago')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="destructive"
        className="h-11"
        onClick={handleDisconnect}
        disabled={loading}
      >
        <Link2Off className="mr-2 size-4" />
        {loading ? 'Desconectando...' : 'Desconectar Mercado Pago'}
      </Button>
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}
    </div>
  )
}
