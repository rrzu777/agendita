'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import {
  attachCustomerPhoto,
  createCustomerPhotoUploadUrl,
  deleteCustomerPhoto,
  getBookingPhotos,
  getCustomerPhotos,
  updateCustomerPhotoCaption,
} from '@/server/actions/customer-photos'
import {
  isAllowedPhotoType,
  PHOTO_ALLOWED_TYPES,
  PHOTO_CAPTION_MAX,
  PHOTO_MAX_BYTES,
  type CustomerPhotoItem,
} from '@/lib/storage/photos'
import { useVocabulary } from '@/components/vocabulary-provider'

interface CustomerPhotosProps {
  /** A qué se cuelgan las fotos nuevas. Desde el drawer alcanza el `bookingId`:
   *  el servidor saca la ficha de la reserva. */
  target: { customerId?: string; bookingId?: string }
  /** La ficha ya las trae del server. Si viene `undefined`, el componente las
   *  pide solo al montarse (es el caso del drawer de la agenda). */
  initialPhotos?: CustomerPhotoItem[]
  /** false cuando R2 no está configurado: se ven las que haya, no se suben más. */
  uploadEnabled: boolean
  /** Grilla más chica, para el panel lateral. */
  compact?: boolean
}

export function CustomerPhotos({
  target,
  initialPhotos,
  uploadEnabled,
  compact = false,
}: CustomerPhotosProps) {
  const vocabulary = useVocabulary()
  const [photos, setPhotos] = useState<CustomerPhotoItem[]>(initialPhotos ?? [])
  const [loading, setLoading] = useState(initialPhotos === undefined)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { customerId, bookingId } = target
  const needsFetch = initialPhotos === undefined

  useEffect(() => {
    if (!needsFetch) return
    let cancelled = false
    async function load() {
      const res = bookingId
        ? await getBookingPhotos(bookingId)
        : customerId
          ? await getCustomerPhotos(customerId)
          : null
      if (cancelled) return
      if (res && res.ok) setPhotos(res.data)
      else if (res) setError(res.error)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [needsFetch, bookingId, customerId])

  const uploadOne = useCallback(
    async (file: File): Promise<string | null> => {
      if (!isAllowedPhotoType(file.type)) return `${file.name}: solo JPG, PNG o WebP`
      if (file.size > PHOTO_MAX_BYTES) return `${file.name}: supera los 5 MB`

      const urlRes = await createCustomerPhotoUploadUrl(target, file.type)
      if (!urlRes.ok) return urlRes.error

      const { uploadUrl, key } = urlRes.data
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (!put.ok) return `${file.name}: no pudimos subirla`

      const attached = await attachCustomerPhoto({ ...target, key, contentType: file.type })
      if (!attached.ok) return attached.error

      const saved = attached.data
      setPhotos((prev) => [saved, ...prev])
      return null
    },
    [target],
  )

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    // El input se limpia YA: si no, elegir el mismo archivo dos veces seguidas
    // no dispara onChange y parece que la subida se colgó.
    e.target.value = ''
    if (files.length === 0) return

    setError(null)
    const failures: string[] = []
    // De a una: la cuota se re-chequea en cada attach, y en paralelo dos subidas
    // podrían pasarse del tope entre el presign y el insert.
    for (const [i, file] of files.entries()) {
      setProgress(files.length > 1 ? `Subiendo ${i + 1} de ${files.length}…` : 'Subiendo…')
      const failure = await uploadOne(file)
      if (failure) failures.push(failure)
    }
    setProgress(null)
    if (failures.length > 0) setError(failures.join(' · '))
  }

  async function handleDelete(photo: CustomerPhotoItem) {
    if (!window.confirm('¿Borrar esta foto? No se puede deshacer.')) return
    setError(null)
    const res = await deleteCustomerPhoto(photo.id)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
  }

  async function handleCaption(photo: CustomerPhotoItem, value: string) {
    const next = value.trim()
    if (next === (photo.caption ?? '')) return
    const res = await updateCustomerPhotoCaption(photo.id, next)
    if (!res.ok) {
      setError(res.error)
      return
    }
    const saved = res.data
    setPhotos((prev) => prev.map((p) => (p.id === saved.id ? saved : p)))
  }

  const busy = progress !== null

  return (
    <div className="space-y-3">
      {uploadEnabled && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={PHOTO_ALLOWED_TYPES.join(',')}
            multiple
            className="hidden"
            onChange={handleFiles}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <ImagePlus className="mr-1 size-3" />
            )}
            {busy ? progress : 'Agregar fotos'}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando fotos…</p>
      ) : photos.length === 0 ? (
        <p className="text-sm italic text-muted-foreground/70">Sin fotos todavía</p>
      ) : (
        <div className={`grid gap-3 ${compact ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3'}`}>
          {photos.map((photo) => (
            <div key={photo.id} className="space-y-1">
              <div className="group relative overflow-hidden rounded-xl border border-border/60">
                <a href={photo.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- la ruta redirige a un GET prefirmado de 60s sobre un bucket privado; next/image no puede optimizar eso */}
                  <img
                    src={photo.url}
                    alt={photo.caption || 'Foto de la ficha'}
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                </a>
                <button
                  type="button"
                  onClick={() => handleDelete(photo)}
                  aria-label="Borrar foto"
                  className="absolute right-1 top-1 rounded-full bg-background/85 p-1.5 text-muted-foreground opacity-0 transition hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <Input
                defaultValue={photo.caption ?? ''}
                maxLength={PHOTO_CAPTION_MAX}
                placeholder="Nota…"
                aria-label="Nota de la foto"
                className="studio-input h-8 text-xs"
                onBlur={(e) => handleCaption(photo, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Privadas: las ve solo tu equipo, {vocabulary.theClient} no.
      </p>
    </div>
  )
}
