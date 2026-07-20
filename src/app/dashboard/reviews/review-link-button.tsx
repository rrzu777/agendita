'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Link, Loader2, MessageCircle } from 'lucide-react'
import { openDeferredPopup } from '@/lib/popup'
import {
  ensureReviewTokenForBooking,
  getReviewLink,
  getReviewWhatsappLink,
} from '@/server/actions/reviews'

interface ReviewLinkButtonProps {
  bookingId: string
  hasToken: boolean
}

export function ReviewLinkButton({ bookingId, hasToken }: ReviewLinkButtonProps) {
  const [loading, setLoading] = useState<null | 'copy' | 'whatsapp'>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleGenerateAndCopy() {
    setLoading('copy')
    setError(null)
    setCopied(false)

    try {
      if (!hasToken) {
        const tokenRes = await ensureReviewTokenForBooking(bookingId)
        if (!tokenRes.ok) {
          setError(tokenRes.error)
          return
        }
      }

      const linkRes = await getReviewLink(bookingId)
      if (!linkRes.ok) {
        setError(linkRes.error)
        return
      }
      if (!linkRes.data) {
        setError('No se pudo generar el link')
        return
      }

      await navigator.clipboard.writeText(linkRes.data)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // navigator.clipboard.writeText puede rechazar (p.ej. NotAllowedError si el
      // documento perdió foco) — sin este catch el botón quedaba pegado en loading.
      setError('No se pudo copiar el link')
    } finally {
      setLoading(null)
    }
  }

  async function handleWhatsapp() {
    setLoading('whatsapp')
    setError(null)

    const popup = openDeferredPopup()

    try {
      const res = await getReviewWhatsappLink(bookingId)
      if (!res.ok) {
        popup.close()
        setError(res.error)
        return
      }
      if (!res.data) {
        popup.close()
        setError('No se pudo preparar el mensaje')
        return
      }

      if (res.data.waUrl) {
        popup.navigate(res.data.waUrl)
      } else {
        // Sin teléfono: caemos a copiar el link.
        popup.close()
        await navigator.clipboard.writeText(res.data.reviewLink)
        setError('La clienta no tiene teléfono. Copiamos el link al portapapeles.')
      }
    } catch {
      popup.close()
      setError('No se pudo copiar el link')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="bg-[#25D366] text-white hover:bg-[#1ebe5b]"
          onClick={handleWhatsapp}
          disabled={loading !== null}
        >
          {loading === 'whatsapp' ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : (
            <MessageCircle className="mr-1 size-4" />
          )}
          WhatsApp
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleGenerateAndCopy}
          disabled={loading !== null}
        >
          {loading === 'copy' ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : copied ? (
            <Copy className="mr-1 size-4 text-green-600" />
          ) : (
            <Link className="mr-1 size-4" />
          )}
          {copied ? 'Copiado' : 'Copiar link'}
        </Button>
      </div>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
