'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { updateBusinessSettings, updateBusinessSchema } from '@/server/actions/business-settings'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import type { Business } from '@prisma/client'
import { Globe, ExternalLink, AlertCircle, CheckCircle2 } from 'lucide-react'
import type { z } from 'zod'

const TIMEZONES = [
  { value: 'America/Santiago', label: 'América/Santiago (Chile)' },
  { value: 'America/Buenos_Aires', label: 'América/Buenos Aires (Argentina)' },
  { value: 'America/Lima', label: 'América/Lima (Perú)' },
  { value: 'America/Mexico_City', label: 'América/México (México)' },
  { value: 'America/Bogota', label: 'América/Bogotá (Colombia)' },
]

type FormData = z.input<typeof updateBusinessSchema>

export function SettingsForm({ business }: { business: Business }) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(updateBusinessSchema),
    defaultValues: {
      name: business.name,
      bio: business.bio || '',
      profileImageUrl: business.profileImageUrl || '',
      logoUrl: business.logoUrl || '',
      whatsapp: business.whatsapp || '',
      instagram: business.instagram || '',
      addressText: business.addressText || '',
      city: business.city,
      timezone: business.timezone,
      subdomain: business.subdomain,
      cancellationPolicy: business.cancellationPolicy || '',
      bookingPolicy: business.bookingPolicy || '',
      depositPolicy: business.depositPolicy || '',
    },
  })

  const watchedValues = watch()

  const publicUrl = getBusinessPublicUrl({
    slug: business.slug,
    subdomain: watchedValues.subdomain || business.subdomain,
  })

  async function onSubmit(data: FormData) {
    setIsSubmitting(true)
    setServerError(null)
    setSuccessMessage(null)

    try {
      await updateBusinessSettings(data)
      setSuccessMessage('Cambios guardados exitosamente')
      setTimeout(() => setSuccessMessage(null), 4000)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al guardar los cambios'
      setServerError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Server error / success */}
        {serverError && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            {serverError}
          </div>
        )}
        {successMessage && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">
            <CheckCircle2 className="size-4 shrink-0" />
            {successMessage}
          </div>
        )}

        {/* Identidad */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Identidad</h3>
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del estudio *</Label>
            <Input id="name" {...register('name')} aria-invalid={!!errors.name} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea id="bio" {...register('bio')} rows={3} />
            {errors.bio && <p className="text-sm text-destructive">{errors.bio.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="logoUrl">URL del logo</Label>
            <Input id="logoUrl" {...register('logoUrl')} placeholder="https://..." />
            {errors.logoUrl && <p className="text-sm text-destructive">{errors.logoUrl.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="profileImageUrl">URL de imagen de perfil</Label>
            <Input id="profileImageUrl" {...register('profileImageUrl')} placeholder="https://..." />
            {errors.profileImageUrl && <p className="text-sm text-destructive">{errors.profileImageUrl.message}</p>}
          </div>
        </section>

        {/* Contacto */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Contacto y redes</h3>
          <div className="space-y-2">
            <Label htmlFor="whatsapp">WhatsApp</Label>
            <Input id="whatsapp" {...register('whatsapp')} placeholder="9 1234 5678" />
            {errors.whatsapp && <p className="text-sm text-destructive">{errors.whatsapp.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="instagram">Instagram</Label>
            <Input id="instagram" {...register('instagram')} placeholder="@miestudio" />
            {errors.instagram && <p className="text-sm text-destructive">{errors.instagram.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="addressText">Dirección</Label>
            <Input id="addressText" {...register('addressText')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">Ciudad *</Label>
            <Input id="city" {...register('city')} />
            {errors.city && <p className="text-sm text-destructive">{errors.city.message}</p>}
          </div>
        </section>

        {/* Dominio */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Dominio</h3>
          <div className="space-y-2">
            <Label htmlFor="subdomain">Subdominio *</Label>
            <Input id="subdomain" {...register('subdomain')} />
            <p className="text-sm text-muted-foreground">
              <Globe className="inline size-3.5 mr-1" />
              Tu URL será: {publicUrl}
            </p>
            {errors.subdomain && <p className="text-sm text-destructive">{errors.subdomain.message}</p>}
          </div>
        </section>

        {/* Regional */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Configuración regional</h3>
          <div className="space-y-2">
            <Label htmlFor="timezone">Zona horaria</Label>
            <Select
              value={watchedValues.timezone}
              onValueChange={(val) => setValue('timezone', val)}
            >
              <SelectTrigger id="timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="currency">Moneda</Label>
            <Input id="currency" value="CLP" disabled />
            <p className="text-xs text-muted-foreground">La moneda no se puede cambiar en este momento.</p>
          </div>
        </section>

        {/* Políticas */}
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-primary">Políticas</h3>
          <div className="space-y-2">
            <Label htmlFor="cancellationPolicy">Política de cancelación</Label>
            <Textarea id="cancellationPolicy" {...register('cancellationPolicy')} rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bookingPolicy">Política de reserva</Label>
            <Textarea id="bookingPolicy" {...register('bookingPolicy')} rows={3} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="depositPolicy">Política de depósito</Label>
            <Textarea id="depositPolicy" {...register('depositPolicy')} rows={3} />
          </div>
        </section>

        <Button type="submit" disabled={isSubmitting} className="w-full md:w-auto">
          {isSubmitting ? 'Guardando...' : 'Guardar cambios'}
        </Button>
      </form>

      {/* Preview */}
      <aside className="space-y-4">
        <h3 className="text-lg font-semibold text-primary">Vista previa del perfil</h3>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-4">
            {watchedValues.logoUrl ? (
              <img
                src={watchedValues.logoUrl}
                alt={watchedValues.name}
                className="size-16 rounded-xl object-cover"
              />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-xl bg-secondary text-2xl font-bold text-primary">
                {watchedValues.name?.charAt(0).toUpperCase() || '?'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h4 className="text-xl font-semibold text-primary truncate">{watchedValues.name || 'Sin nombre'}</h4>
              <p className="text-sm text-muted-foreground">{watchedValues.city || 'Sin ciudad'}</p>
            </div>
          </div>
          {watchedValues.bio && (
            <p className="mt-4 text-sm text-muted-foreground line-clamp-3">{watchedValues.bio}</p>
          )}
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Ver perfil público <ExternalLink className="size-3.5" />
          </a>
        </div>
      </aside>
    </div>
  )
}
