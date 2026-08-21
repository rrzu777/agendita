'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
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

  const replaceBaseline = useCallback((values: ProfileSettingsInput) => {
    reset(values)
    setBaseline(values)
    setDraftValues(values)
  }, [reset])

  const draft = useSettingsDraft({
    scope: 'profile',
    key: `${businessId}:profile`,
    version: DRAFT_VERSION,
    baseline,
    values: draftValues,
    isDirty,
    reset,
    replaceBaseline,
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
    } finally {
      submitInFlight.current = false
    }
  }

  function onInvalidSubmit() {
    submitInFlight.current = false
  }

  function submitForm(event: React.FormEvent<HTMLFormElement>) {
    if (submitInFlight.current) {
      event.preventDefault()
      return
    }

    submitInFlight.current = true
    void handleSubmit(onSubmit, onInvalidSubmit)(event).catch(() => {
      submitInFlight.current = false
    })
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
        {draft.recovery === 'verification-failed' && (
          <p role="status" className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            No pudimos verificar el borrador con el servidor. No se aplicó ni se eliminó; vuelve a intentarlo con conexión.
          </p>
        )}

        <fieldset disabled={isSubmitting} aria-label="Campos del perfil" aria-busy={isSubmitting} className="space-y-10 disabled:opacity-70">
          <SettingsFormSection title="Identidad" description="La información principal que verá tu público.">
            <FormField id="profile-name" label="Nombre del negocio" error={errors.name?.message}>
              {(a11y) => <Input id="profile-name" density="form" {...register('name')} {...a11y} />}
            </FormField>
            <FormField id="profile-bio" label="Descripción" error={errors.bio?.message}>
              {(a11y) => <Textarea id="profile-bio" density="form" {...register('bio')} rows={4} {...a11y} />}
            </FormField>
            <FormField id="profile-logo-url" label="URL del logo" error={errors.logoUrl?.message} help="Pega una URL pública para mostrar tu logo en el perfil.">
              {(a11y) => <Input id="profile-logo-url" density="form" type="url" placeholder="https://..." {...register('logoUrl')} {...a11y} />}
            </FormField>
            <FormField id="profile-image-url" label="URL de imagen de perfil" error={errors.profileImageUrl?.message} help="Pega una URL pública para agregar una imagen a tu perfil.">
              {(a11y) => <Input id="profile-image-url" density="form" type="url" placeholder="https://..." {...register('profileImageUrl')} {...a11y} />}
            </FormField>
          </SettingsFormSection>

          <SettingsFormSection title="Contacto y ubicación" description="Canales y ubicación que puedes mostrar a tu público.">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="profile-whatsapp" label="WhatsApp" error={errors.whatsapp?.message}>
                {(a11y) => <Input id="profile-whatsapp" density="form" inputMode="tel" placeholder="9 1234 5678" {...register('whatsapp')} {...a11y} />}
              </FormField>
              <FormField id="profile-instagram" label="Instagram" error={errors.instagram?.message}>
                {(a11y) => <Input id="profile-instagram" density="form" placeholder="@mi-negocio" {...register('instagram')} {...a11y} />}
              </FormField>
            </div>
            <FormField id="profile-address" label="Dirección" error={errors.addressText?.message}>
              {(a11y) => <Input id="profile-address" density="form" {...register('addressText')} {...a11y} />}
            </FormField>
            <FormField id="profile-city" label="Ciudad" error={errors.city?.message}>
              {(a11y) => <Input id="profile-city" density="form" {...register('city')} {...a11y} />}
            </FormField>
          </SettingsFormSection>

          <SettingsFormSection title="Dirección pública" description="El enlace que compartirás con quienes quieran conocerte o reservar.">
            <FormField id="profile-subdomain" label="Subdominio" error={errors.subdomain?.message} help={`Tu URL pública será: ${publicUrl}`}>
              {(a11y) => <Input id="profile-subdomain" density="form" autoCapitalize="none" {...register('subdomain')} {...a11y} />}
            </FormField>
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
