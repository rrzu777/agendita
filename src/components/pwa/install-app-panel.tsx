'use client'

import { useState, useSyncExternalStore } from 'react'
import { Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  clearInstallPrompt,
  getInstallPrompt,
  subscribeToInstallPrompt,
} from '@/lib/pwa/install-prompt'

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

let installedThisSession = false

function getInstalledState() {
  return installedThisSession
    || window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function subscribeToInstalledState(onStoreChange: () => void) {
  const displayMode = window.matchMedia?.('(display-mode: standalone)')
  function handleInstalled() {
    installedThisSession = true
    onStoreChange()
  }
  displayMode?.addEventListener?.('change', onStoreChange)
  window.addEventListener('appinstalled', handleInstalled)
  return () => {
    displayMode?.removeEventListener?.('change', onStoreChange)
    window.removeEventListener('appinstalled', handleInstalled)
  }
}

export function InstallAppPanel() {
  const promptEvent = useSyncExternalStore(
    subscribeToInstallPrompt,
    getInstallPrompt,
    () => null,
  )
  const installed = useSyncExternalStore(subscribeToInstalledState, getInstalledState, () => false)
  const [showInstructions, setShowInstructions] = useState(false)
  const ios = typeof navigator !== 'undefined' && isIosDevice()

  async function install() {
    if (!promptEvent) {
      setShowInstructions(true)
      return
    }

    try {
      await promptEvent.prompt()
      await promptEvent.userChoice
    } catch {
      setShowInstructions(true)
    } finally {
      clearInstallPrompt()
    }
  }

  if (installed) {
    return (
      <div className="mt-8 rounded-2xl border border-primary/15 bg-secondary/50 p-4 text-center">
        <p className="font-semibold text-primary">Agendita ya está instalada</p>
        <p className="mt-1 text-sm text-muted-foreground">Ábrela desde el ícono de tu pantalla de inicio.</p>
      </div>
    )
  }

  return (
    <div className="mt-8 space-y-3">
      <Button
        type="button"
        onClick={install}
        aria-expanded={showInstructions}
        aria-controls="pwa-install-instructions"
        className="h-12 w-full rounded-full text-base font-semibold"
      >
        Instalar ahora
      </Button>
      {showInstructions && (
        <div
          id="pwa-install-instructions"
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-primary/15 bg-secondary/45 p-4 text-sm leading-relaxed text-primary"
        >
          {ios ? (
            <p>
              Toca <Share2 className="mx-1 inline size-4" aria-hidden="true" /> <strong>Compartir</strong> y luego
              {' '}<strong>Agregar a pantalla de inicio</strong>.
            </p>
          ) : (
            <p>Abre el menú de tu navegador y elige <strong>Instalar aplicación</strong> o <strong>Agregar a pantalla de inicio</strong>.</p>
          )}
        </div>
      )}
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        No ocupa una descarga de tienda y puedes eliminarla cuando quieras.
      </p>
    </div>
  )
}
