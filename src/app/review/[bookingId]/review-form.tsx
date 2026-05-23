'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Star } from 'lucide-react'
import { submitReview } from '@/server/actions/reviews'

interface ReviewFormProps {
  bookingId: string
  token: string
}

export function ReviewForm({ bookingId, token }: ReviewFormProps) {
  const [rating, setRating] = useState(0)
  const [hoveredRating, setHoveredRating] = useState(0)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const canSubmit = rating >= 1 && rating <= 5

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    setError(null)

    try {
      await submitReview({
        bookingId,
        token,
        rating,
        comment: comment.trim() || null,
      })
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ocurrió un error inesperado.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="mt-6 text-center">
        <div className="mb-4 text-4xl text-primary">★</div>
        <h2 className="text-xl font-semibold text-primary">¡Gracias por tu reseña!</h2>
        <p className="mt-2 text-muted-foreground">
          Tu reseña está pendiente de aprobación y será visible pronto en el perfil del negocio.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-5">
      <div>
        <label className="studio-eyebrow mb-2 block">Calificación</label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(0)}
              className="p-0.5 transition-transform active:scale-90"
            >
              <Star
                className={`size-8 ${
                  star <= (hoveredRating || rating)
                    ? 'fill-primary text-primary'
                    : 'text-muted-foreground/30'
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="comment" className="studio-eyebrow mb-2 block">
          Comentario <span className="text-muted-foreground">(opcional)</span>
        </label>
        <textarea
          id="comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          rows={4}
          className="w-full resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="Comparte tu experiencia..."
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {comment.length}/1000
        </p>
      </div>

      {error && (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" disabled={!canSubmit || loading} className="h-12 w-full rounded-xl text-base font-semibold">
        {loading ? 'Enviando...' : 'Enviar reseña'}
      </Button>
    </form>
  )
}
