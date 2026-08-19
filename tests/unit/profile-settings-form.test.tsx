import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnsavedChangesProvider } from '@/components/dashboard/unsaved-changes-provider'
import { writeSettingsDraft } from '@/lib/business/settings-draft'
import type { ProfileSettingsInput } from '@/lib/business/schema'
import { ProfileSettingsForm } from '@/components/dashboard/settings/profile-settings-form'
import { PublicProfilePreview } from '@/components/dashboard/settings/public-profile-preview'

const { mockUpdateProfile } = vi.hoisted(() => ({ mockUpdateProfile: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/server/actions/business-settings', () => ({ updateProfileSettings: mockUpdateProfile }))

const profileValues: ProfileSettingsInput = {
  name: 'Mi Negocio',
  bio: '',
  profileImageUrl: '',
  logoUrl: '',
  whatsapp: '',
  instagram: '',
  addressText: '',
  city: 'Santiago',
  subdomain: 'mi-negocio',
}

function getInput(container: HTMLElement, label: string) {
  const labelElement = Array.from(container.querySelectorAll('label')).find((element) => element.textContent === label)
  const inputId = labelElement?.getAttribute('for')
  const input = inputId ? container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${inputId}`) : null
  if (!input) throw new Error(`Input not found for ${label}`)
  return input
}

async function setInput(container: HTMLElement, label: string, value: string) {
  const input = getInput(container, label)
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit(container: HTMLElement) {
  const form = container.querySelector('form')
  if (!form) throw new Error('Profile form not found')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

function deferred<T>() {
  let resolve: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve: (value: T) => resolve(value) }
}

describe('ProfileSettingsForm', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    sessionStorage.clear()
    mockUpdateProfile.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function renderProfile({
    initialValues = profileValues,
    strict = false,
  }: {
    initialValues?: ProfileSettingsInput
    strict?: boolean
  } = {}) {
    const form = (
      <UnsavedChangesProvider>
        <ProfileSettingsForm businessId="biz-1" slug="mi-negocio" initialValues={initialValues} />
      </UnsavedChangesProvider>
    )
    await act(async () => {
      root.render(strict ? <StrictMode>{form}</StrictMode> : form)
    })
  }

  it('submits profile fields only and replaces dirty values with the normalized response', async () => {
    mockUpdateProfile.mockResolvedValue({ ok: true, data: { ...profileValues, whatsapp: '+56912345678' } })
    await renderProfile()

    await setInput(container, 'WhatsApp', '9 1234 5678')
    await submit(container)

    const payload = mockUpdateProfile.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.businessId).toBeUndefined()
    expect(payload.timezone).toBeUndefined()
    expect(getInput(container, 'WhatsApp').value).toBe('+56912345678')
    expect(container.textContent).toContain('Cambios guardados')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  })

  it('locks edits and re-entry until a pending profile update resolves', async () => {
    const pending = deferred<{ ok: true; data: ProfileSettingsInput }>()
    mockUpdateProfile.mockReturnValue(pending.promise)
    await renderProfile()

    await setInput(container, 'WhatsApp', '9 1234 5678')
    await submit(container)

    const whatsapp = getInput(container, 'WhatsApp')
    const fieldset = container.querySelector('fieldset')
    expect(fieldset?.disabled).toBe(true)
    expect(whatsapp.matches(':disabled')).toBe(true)
    const valueWhilePending = whatsapp.value
    whatsapp.focus()
    expect(document.activeElement).not.toBe(whatsapp)
    expect(whatsapp.value).toBe(valueWhilePending)

    await submit(container)
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1)
    expect(fieldset?.disabled).toBe(true)
    expect(whatsapp.matches(':disabled')).toBe(true)
    const saveButton = container.querySelector<HTMLButtonElement>('button[type="submit"]')
    expect(saveButton?.disabled).toBe(true)
    expect(saveButton?.textContent).toBe('Guardando…')

    await act(async () => pending.resolve({ ok: true, data: { ...profileValues, whatsapp: '+56912345678' } }))

    expect(getInput(container, 'WhatsApp').value).toBe('+56912345678')
    expect(container.querySelector('fieldset')?.disabled).toBe(false)
    expect(sessionStorage.getItem('biz-1:profile')).toBeNull()
  })

  it('releases the submit lock after client validation rejects the form', async () => {
    mockUpdateProfile.mockResolvedValue({ ok: true, data: profileValues })
    await renderProfile()

    await setInput(container, 'Nombre del negocio', '')
    await submit(container)
    expect(container.querySelector('#profile-name-error')).not.toBeNull()
    expect(mockUpdateProfile).not.toHaveBeenCalled()

    await setInput(container, 'Nombre del negocio', 'Negocio corregido')
    await submit(container)

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1)
  })

  it('updates the public preview from a profile field', async () => {
    await renderProfile()

    await setInput(container, 'Nombre del negocio', 'Mi Negocio nuevo')

    expect(Array.from(container.querySelectorAll('h2')).some((heading) => heading.textContent === 'Mi Negocio nuevo')).toBe(true)
  })

  it('keeps values and shows a reserved subdomain error returned by the action', async () => {
    mockUpdateProfile.mockResolvedValue({ ok: false, error: 'Este subdominio está reservado' })
    await renderProfile()

    await setInput(container, 'Subdominio', 'admin')
    await submit(container)

    expect(container.textContent).toContain('Este subdominio está reservado')
    expect(getInput(container, 'Subdominio').value).toBe('admin')
  })

  it('associates only rendered help and error text with their controls', async () => {
    await renderProfile()

    const logo = getInput(container, 'URL del logo')
    expect(logo.getAttribute('aria-describedby')).toBe('profile-logo-url-help')
    expect(container.querySelector('#profile-logo-url-help')?.textContent).toContain('URL pública')

    await setInput(container, 'Nombre del negocio', '')
    await submit(container)

    const name = getInput(container, 'Nombre del negocio')
    expect(name.getAttribute('aria-describedby')).toBe('profile-name-error')
    expect(container.querySelector('#profile-name-error')?.getAttribute('role')).toBe('alert')
    const ids = Array.from(container.querySelectorAll('[id]')).map((element) => element.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('announces a restored draft whose baseline still matches the server', async () => {
    writeSettingsDraft(sessionStorage, 'biz-1:profile', 1, profileValues, { ...profileValues, name: 'Borrador recuperado' })
    await renderProfile()

    expect(container.textContent).toContain('Recuperamos un borrador local')
    expect(getInput(container, 'Nombre del negocio').value).toBe('Borrador recuperado')
  })

  it('keeps fresh server values when draft baseline A conflicts with server C', async () => {
    const serverValues = { ...profileValues, name: 'Servidor C' }
    writeSettingsDraft(
      sessionStorage,
      'biz-1:profile',
      1,
      { ...profileValues, name: 'Servidor A' },
      { ...profileValues, name: 'Borrador B' },
    )

    await renderProfile({ initialValues: serverValues })

    expect(container.textContent).toContain('Hay un borrador local de una versión anterior')
    expect(getInput(container, 'Nombre del negocio').value).toBe('Servidor C')
  })

  it('reloads exactly once without restoring against a stale baseline on persisted pageshow', async () => {
    const historyGo = vi.spyOn(window.history, 'go').mockImplementation(() => {})
    await renderProfile({ strict: true })
    writeSettingsDraft(
      sessionStorage,
      'biz-1:profile',
      1,
      profileValues,
      { ...profileValues, bio: 'Borrador desde historial' },
    )

    await act(async () => {
      const pageshow = new Event('pageshow')
      Object.defineProperty(pageshow, 'persisted', { value: true })
      window.dispatchEvent(pageshow)
    })

    expect(historyGo).toHaveBeenCalledTimes(1)
    expect(historyGo).toHaveBeenCalledWith(0)
    expect(getInput(container, 'Descripción').value).toBe(profileValues.bio)
    expect(container.textContent).not.toContain('Recuperamos un borrador local')
    historyGo.mockRestore()
  })

  it('wraps long city and bio tokens in the public preview', () => {
    const html = renderToStaticMarkup(
      <PublicProfilePreview
        name="Mi Negocio"
        city="CiudadConUnTokenExcepcionalmenteLargoSinEspacios"
        bio="DescripciónConUnTokenExcepcionalmenteLargoSinEspacios"
        logoUrl=""
        publicUrl="https://mi-negocio.example.com"
      />,
    )

    expect(html).toMatch(/CiudadConUnTokenExcepcionalmenteLargoSinEspacios<\/p>/)
    expect(html).toMatch(/class="[^"]*break-words[^"]*"[^>]*>CiudadConUnTokenExcepcionalmenteLargoSinEspacios<\/p>/)
    expect(html).toMatch(/class="[^"]*break-words[^"]*"[^>]*>DescripciónConUnTokenExcepcionalmenteLargoSinEspacios<\/p>/)
  })
})
