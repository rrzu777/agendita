'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { disconnectMercadoPago } from '@/server/actions/mercado-pago-connect'
import { Link2Off } from 'lucide-react'

export function DisconnectButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDisconnect() {
    setLoading(true)
    try {
      await disconnectMercadoPago()
      router.refresh()
    } catch {
      // Error shown via router refresh
    } finally {
      setLoading(false)
    }
  }

  return (
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
  )
}
