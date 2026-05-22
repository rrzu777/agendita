'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Link, Loader2 } from 'lucide-react'
import { ensureReviewTokenForBooking, getReviewLink } from '@/server/actions/reviews'

interface ReviewLinkButtonProps {
  bookingId: string
  hasToken: boolean
}

export function ReviewLinkButton({ bookingId, hasToken }: ReviewLinkButtonProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleGenerateAndCopy() {
    setLoading(true)
    setError(null)
    setCopied(false)

    try {
      if (!hasToken) {
        await ensureReviewTokenForBooking(bookingId)
      }

      const link = await getReviewLink(bookingId)
      if (!link) {
        setError('No se pudo generar el link')
        return
      }

      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar link')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={handleGenerateAndCopy}
        disabled={loading}
      >
        {loading ? (
          <Loader2 className="mr-1 size-4 animate-spin" />
        ) : copied ? (
          <Copy className="mr-1 size-4 text-green-600" />
        ) : (
          <Link className="mr-1 size-4" />
        )}
        {copied ? 'Copiado' : loading ? 'Generando...' : 'Link reseña'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
