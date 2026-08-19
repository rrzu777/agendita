'use client'

import { useEffect, useRef, useState } from 'react'
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
  const submitInFlight = useRef(false)
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
    if (submitInFlight.current) return
    submitInFlight.current = true
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
    } finally {
      submitInFlight.current = false
    }
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    void handleSubmit(onSubmit)(event)
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
      <form onSubmit={submitForm} className="min-w-0 space-y-10">
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

        <fieldset disabled={isSubmitting} aria-label="Campos del perfil" aria-busy={isSubmitting} className="space-y-10 disabled:opacity-70">
          <SettingsFormSection title="Identidad" description="La información principal que verá tu público.">
            <FieldError controlId="profile-name" error={errors.name?.message}>
              {(describedBy) => <><Label htmlFor="profile-name">Nombre del negocio</Label><Input id="profile-name" {...register('name')} aria-invalid={Boolean(errors.name)} aria-describedby={describedBy} /></>}
            </FieldError>
            <FieldError controlId="profile-bio" error={errors.bio?.message}>
              {(describedBy) => <><Label htmlFor="profile-bio">Descripción</Label><Textarea id="profile-bio" {...register('bio')} rows={4} aria-invalid={Boolean(errors.bio)} aria-describedby={describedBy} /></>}
            </FieldError>
            <FieldError controlId="profile-logo-url" error={errors.logoUrl?.message} help="Pega una URL pública para mostrar tu logo en el perfil.">
              {(describedBy) => <><Label htmlFor="profile-logo-url">URL del logo</Label><Input id="profile-logo-url" type="url" placeholder="https://..." {...register('logoUrl')} aria-invalid={Boolean(errors.logoUrl)} aria-describedby={describedBy} /></>}
            </FieldError>
            <FieldError controlId="profile-image-url" error={errors.profileImageUrl?.message} help="Pega una URL pública para agregar una imagen a tu perfil.">
              {(describedBy) => <><Label htmlFor="profile-image-url">URL de imagen de perfil</Label><Input id="profile-image-url" type="url" placeholder="https://..." {...register('profileImageUrl')} aria-invalid={Boolean(errors.profileImageUrl)} aria-describedby={describedBy} /></>}
            </FieldError>
          </SettingsFormSection>

          <SettingsFormSection title="Contacto y ubicación" description="Canales y ubicación que puedes mostrar a tu público.">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldError controlId="profile-whatsapp" error={errors.whatsapp?.message}>
                {(describedBy) => <><Label htmlFor="profile-whatsapp">WhatsApp</Label><Input id="profile-whatsapp" inputMode="tel" placeholder="9 1234 5678" {...register('whatsapp')} aria-invalid={Boolean(errors.whatsapp)} aria-describedby={describedBy} /></>}
              </FieldError>
              <FieldError controlId="profile-instagram" error={errors.instagram?.message}>
                {(describedBy) => <><Label htmlFor="profile-instagram">Instagram</Label><Input id="profile-instagram" placeholder="@mi-negocio" {...register('instagram')} aria-invalid={Boolean(errors.instagram)} aria-describedby={describedBy} /></>}
              </FieldError>
            </div>
            <FieldError controlId="profile-address" error={errors.addressText?.message}>
              {(describedBy) => <><Label htmlFor="profile-address">Dirección</Label><Input id="profile-address" {...register('addressText')} aria-invalid={Boolean(errors.addressText)} aria-describedby={describedBy} /></>}
            </FieldError>
            <FieldError controlId="profile-city" error={errors.city?.message}>
              {(describedBy) => <><Label htmlFor="profile-city">Ciudad</Label><Input id="profile-city" {...register('city')} aria-invalid={Boolean(errors.city)} aria-describedby={describedBy} /></>}
            </FieldError>
          </SettingsFormSection>

          <SettingsFormSection title="Dirección pública" description="El enlace que compartirás con quienes quieran conocerte o reservar.">
            <FieldError controlId="profile-subdomain" error={errors.subdomain?.message} help={`Tu URL pública será: ${publicUrl}`}>
              {(describedBy) => <><Label htmlFor="profile-subdomain">Subdominio</Label><Input id="profile-subdomain" autoCapitalize="none" {...register('subdomain')} aria-invalid={Boolean(errors.subdomain)} aria-describedby={describedBy} /></>}
            </FieldError>
          </SettingsFormSection>
        </fieldset>

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

function FieldError({
  children,
  controlId,
  error,
  help,
}: {
  children: (describedBy?: string) => React.ReactNode
  controlId: string
  error?: string
  help?: string
}) {
  const helpId = help ? `${controlId}-help` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="space-y-2">
      {children(describedBy)}
      {help && <p id={helpId} className="text-xs text-muted-foreground">{help}</p>}
      {error && <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
