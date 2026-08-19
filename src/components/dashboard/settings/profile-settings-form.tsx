'use client'

import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SettingsFormSection } from '@/components/dashboard/settings/settings-form-section'
import { SettingsSaveBar } from '@/components/dashboard/settings/settings-save-bar'
import { useSettingsDraft } from '@/components/dashboard/settings/use-settings-draft'
import { useUnsavedChangesRegistration } from '@/components/dashboard/unsaved-changes-provider'
import { PublicProfilePreview } from '@/components/dashboard/settings/public-profile-preview'
import { profileSettingsSchema, type ProfileSettingsInput } from '@/lib/business/schema'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import { updateProfileSettings } from '@/server/actions/business-settings'

type ProfileSettingsFormProps = {
  businessId: string
  slug: string
  initialValues: ProfileSettingsInput
}

const DRAFT_VERSION = 1

export function ProfileSettingsForm({ businessId, slug, initialValues }: ProfileSettingsFormProps) {
  const [baseline, setBaseline] = useState(initialValues)
  const [draftValues, setDraftValues] = useState(initialValues)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<ProfileSettingsInput>({
    resolver: zodResolver(profileSettingsSchema),
    defaultValues: initialValues,
  })
  const {
    control,
    register,
    handleSubmit,
    reset,
    subscribe,
    formState: { errors, isDirty, isSubmitting },
  } = form
  const [name, city, bio, logoUrl, subdomain] = useWatch({
    control,
    name: ['name', 'city', 'bio', 'logoUrl', 'subdomain'],
  })

  useEffect(() => subscribe({
    formState: { values: true },
    callback: ({ values }) => setDraftValues(values),
  }), [subscribe])

  const draft = useSettingsDraft({
    key: `${businessId}:profile`,
    version: DRAFT_VERSION,
    baseline,
    values: draftValues,
    isDirty,
    reset,
  })

  useUnsavedChangesRegistration({ scope: 'profile', isDirty, discard: draft.discard })

  const publicUrl = getBusinessPublicUrl({ slug, subdomain: subdomain || null })

  async function onSubmit(values: ProfileSettingsInput) {
    setStatus('idle')
    setServerError(null)

    try {
      const response = await updateProfileSettings(values)
      if (!response.ok) {
        setServerError(response.error)
        setStatus('error')
        return
      }

      reset(response.data)
      setBaseline(response.data)
      setDraftValues(response.data)
      draft.clearDraft()
      setStatus('saved')
    } catch {
      setServerError('No se pudieron guardar los cambios. Intenta nuevamente.')
      setStatus('error')
    }
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
      <form onSubmit={handleSubmit(onSubmit)} className="min-w-0 space-y-10">
        {draft.recovery === 'restored' && (
          <p role="status" className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            Recuperamos un borrador local para que puedas continuar editando.
          </p>
        )}
        {draft.recovery === 'conflict' && (
          <p role="status" className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            Hay un borrador local de una versión anterior y no se aplicó para evitar sobrescribir cambios recientes.
          </p>
        )}

        <SettingsFormSection title="Identidad" description="La información principal que verá tu público.">
          <FieldError error={errors.name?.message}>
            <Label htmlFor="profile-name">Nombre del negocio</Label>
            <Input id="profile-name" {...register('name')} aria-invalid={Boolean(errors.name)} />
          </FieldError>
          <FieldError error={errors.bio?.message}>
            <Label htmlFor="profile-bio">Descripción</Label>
            <Textarea id="profile-bio" {...register('bio')} rows={4} aria-invalid={Boolean(errors.bio)} />
          </FieldError>
          <FieldError error={errors.logoUrl?.message}>
            <Label htmlFor="profile-logo-url">URL del logo</Label>
            <Input id="profile-logo-url" type="url" placeholder="https://..." {...register('logoUrl')} aria-invalid={Boolean(errors.logoUrl)} />
            <p className="text-xs text-muted-foreground">Pega una URL pública para mostrar tu logo en el perfil.</p>
          </FieldError>
          <FieldError error={errors.profileImageUrl?.message}>
            <Label htmlFor="profile-image-url">URL de imagen de perfil</Label>
            <Input id="profile-image-url" type="url" placeholder="https://..." {...register('profileImageUrl')} aria-invalid={Boolean(errors.profileImageUrl)} />
            <p className="text-xs text-muted-foreground">Pega una URL pública para agregar una imagen a tu perfil.</p>
          </FieldError>
        </SettingsFormSection>

        <SettingsFormSection title="Contacto y ubicación" description="Canales y ubicación que puedes mostrar a tu público.">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldError error={errors.whatsapp?.message}>
              <Label htmlFor="profile-whatsapp">WhatsApp</Label>
              <Input id="profile-whatsapp" inputMode="tel" placeholder="9 1234 5678" {...register('whatsapp')} aria-invalid={Boolean(errors.whatsapp)} />
            </FieldError>
            <FieldError error={errors.instagram?.message}>
              <Label htmlFor="profile-instagram">Instagram</Label>
              <Input id="profile-instagram" placeholder="@mi-negocio" {...register('instagram')} aria-invalid={Boolean(errors.instagram)} />
            </FieldError>
          </div>
          <FieldError error={errors.addressText?.message}>
            <Label htmlFor="profile-address">Dirección</Label>
            <Input id="profile-address" {...register('addressText')} aria-invalid={Boolean(errors.addressText)} />
          </FieldError>
          <FieldError error={errors.city?.message}>
            <Label htmlFor="profile-city">Ciudad</Label>
            <Input id="profile-city" {...register('city')} aria-invalid={Boolean(errors.city)} />
          </FieldError>
        </SettingsFormSection>

        <SettingsFormSection title="Dirección pública" description="El enlace que compartirás con quienes quieran conocerte o reservar.">
          <FieldError error={errors.subdomain?.message}>
            <Label htmlFor="profile-subdomain">Subdominio</Label>
            <Input id="profile-subdomain" autoCapitalize="none" {...register('subdomain')} aria-invalid={Boolean(errors.subdomain)} />
            <p className="break-all text-sm text-muted-foreground">Tu URL pública será: {publicUrl}</p>
          </FieldError>
        </SettingsFormSection>

        <SettingsSaveBar isDirty={isDirty} isSubmitting={isSubmitting} status={status} error={serverError} />
      </form>

      <PublicProfilePreview
        name={name || ''}
        city={city || ''}
        bio={bio || ''}
        logoUrl={logoUrl || ''}
        publicUrl={publicUrl}
      />
    </div>
  )
}

function FieldError({ children, error }: { children: React.ReactNode; error?: string }) {
  return (
    <div className="space-y-2">
      {children}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
