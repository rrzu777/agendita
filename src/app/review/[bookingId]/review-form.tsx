'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Textarea } from '@/components/ui/textarea'
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

    const res = await submitReview({
      bookingId,
      token,
      rating,
      comment: comment.trim() || null,
    })
    if (!res.ok) {
      setError(res.error)
      setLoading(false)
      return
    }
    setSuccess(true)
    setLoading(false)
  }

  if (success) {
    return (
      <div className="mt-6 text-center">
        <div className="mb-4 text-4xl text-primary">★</div>
        <h2 className="text-xl font-semibold text-primary">¡Gracias por tu reseña!</h2>
        <p className="mt-2 text-muted-foreground">
          Gracias por compartir tu experiencia.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-5">
      <fieldset>
        <legend className="studio-eyebrow mb-2 block">Calificación</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              aria-label={`${star} ${star === 1 ? 'estrella' : 'estrellas'}`}
              aria-pressed={rating === star}
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(0)}
              className="flex size-12 items-center justify-center rounded-lg transition-transform focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-90"
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
      </fieldset>

      <FormField
        id="comment"
        label={<>Comentario <span className="text-muted-foreground">(opcional)</span></>}
        help={<span className="block text-right">{comment.length}/1000</span>}
      >
        {(a11y) => (
          <Textarea
            {...a11y}
            id="comment"
            density="touch"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
            rows={4}
            className="resize-none rounded-xl"
            placeholder="Comparte tu experiencia..."
          />
        )}
      </FormField>

      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" size="touch" disabled={!canSubmit || loading} className="w-full rounded-xl font-semibold">
        {loading ? 'Enviando...' : 'Enviar reseña'}
      </Button>
    </form>
  )
}
