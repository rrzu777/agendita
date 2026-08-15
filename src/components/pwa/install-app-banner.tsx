'use client'

import { useSyncExternalStore } from 'react'
import { Download, X } from 'lucide-react'

type InstallAppBannerProps = {
  canonicalOrigin: string
}

const DISMISSAL_KEY = 'agendita:pwa-install-dismissed-until'
const DISMISSAL_EVENT = 'agendita:pwa-install-dismissal-change'
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
let restrictedStorageDismissedUntil = 0

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function getBannerVisibility() {
  if (isStandalone()) return false

  try {
    const dismissedUntil = Number(window.localStorage.getItem(DISMISSAL_KEY) || 0)
    return !Number.isFinite(dismissedUntil) || dismissedUntil <= Date.now()
  } catch {
    return restrictedStorageDismissedUntil <= Date.now()
  }
}

function subscribeToVisibility(onStoreChange: () => void) {
  const displayMode = window.matchMedia?.('(display-mode: standalone)')
  window.addEventListener('storage', onStoreChange)
  window.addEventListener(DISMISSAL_EVENT, onStoreChange)
  displayMode?.addEventListener?.('change', onStoreChange)

  return () => {
    window.removeEventListener('storage', onStoreChange)
    window.removeEventListener(DISMISSAL_EVENT, onStoreChange)
    displayMode?.removeEventListener?.('change', onStoreChange)
  }
}

export function InstallAppBanner({ canonicalOrigin }: InstallAppBannerProps) {
  const visible = useSyncExternalStore(subscribeToVisibility, getBannerVisibility, () => false)

  function dismiss() {
    const dismissedUntil = Date.now() + THIRTY_DAYS_MS
    try {
      window.localStorage.setItem(DISMISSAL_KEY, String(dismissedUntil))
    } catch {
      restrictedStorageDismissedUntil = dismissedUntil
    }
    window.dispatchEvent(new Event(DISMISSAL_EVENT))
  }

  return (
    <aside
      hidden={!visible}
      aria-label="Instalar Agendita"
      className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md rounded-2xl border border-primary/20 bg-card/95 p-4 shadow-[0_18px_50px_rgba(51,41,32,0.18)] backdrop-blur"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-primary">
          <Download className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-heading font-semibold text-primary">Ten tus citas y recordatorios a mano</p>
          <p className="mt-0.5 text-sm text-muted-foreground">Instala Agendita en tu teléfono.</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Ahora no"
          className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-3 flex items-center justify-end gap-3 pl-14">
        <button type="button" onClick={dismiss} className="text-sm font-semibold text-muted-foreground hover:text-primary">
          Ahora no
        </button>
        <a
          href={`${canonicalOrigin}/instalar`}
          onClick={dismiss}
          className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Instalar Agendita
        </a>
      </div>
    </aside>
  )
}
