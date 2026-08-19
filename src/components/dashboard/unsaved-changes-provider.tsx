'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEventHandler,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type DirtyRegistration = {
  scope: string
  discard: () => void
}

type UnsavedChangesContextValue = {
  hasUnsavedChanges: boolean
  requestNavigation: (proceed: () => void) => void
  registerDirty: (id: string, registration: DirtyRegistration) => () => void
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null)

function useUnsavedChangesContext() {
  const context = useContext(UnsavedChangesContext)
  if (!context) {
    throw new Error('UnsavedChangesProvider is required for dashboard navigation')
  }
  return context
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [registrations, setRegistrations] = useState<Map<string, DirtyRegistration>>(() => new Map())
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null)

  const registerDirty = useCallback((id: string, registration: DirtyRegistration) => {
    setRegistrations((current) => {
      const previous = current.get(id)
      if (previous?.scope === registration.scope && previous.discard === registration.discard) return current

      const next = new Map(current)
      next.set(id, registration)
      return next
    })

    return () => {
      setRegistrations((current) => {
        if (!current.has(id)) return current
        const next = new Map(current)
        next.delete(id)
        return next
      })
    }
  }, [])

  const hasUnsavedChanges = registrations.size > 0

  useEffect(() => {
    if (!hasUnsavedChanges) return

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges])

  const requestNavigation = useCallback((proceed: () => void) => {
    if (!hasUnsavedChanges) {
      proceed()
      return
    }
    setPendingNavigation(() => proceed)
  }, [hasUnsavedChanges])

  const discardAndProceed = useCallback(() => {
    const proceed = pendingNavigation
    if (!proceed) return

    setPendingNavigation(null)
    for (const registration of registrations.values()) {
      registration.discard()
    }
    proceed()
  }, [pendingNavigation, registrations])

  const value = useMemo<UnsavedChangesContextValue>(() => ({
    hasUnsavedChanges,
    requestNavigation,
    registerDirty,
  }), [hasUnsavedChanges, registerDirty, requestNavigation])

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      <Dialog open={pendingNavigation !== null} onOpenChange={(open) => { if (!open) setPendingNavigation(null) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Cambios sin guardar</DialogTitle>
            <DialogDescription>
              Si continúas, se descartarán los cambios que todavía no guardaste.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingNavigation(null)}>
              Seguir editando
            </Button>
            <Button type="button" variant="destructive" onClick={discardAndProceed}>
              Descartar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UnsavedChangesContext.Provider>
  )
}

export function useUnsavedChangesRegistration({
  scope,
  isDirty,
  discard,
}: {
  scope: string
  isDirty: boolean
  discard: () => void
}) {
  const id = useId()
  const { registerDirty } = useUnsavedChangesContext()

  useEffect(() => {
    if (!isDirty) return
    return registerDirty(id, { scope, discard })
  }, [discard, id, isDirty, registerDirty, scope])
}

export function useUnsavedChanges() {
  const { hasUnsavedChanges, requestNavigation } = useUnsavedChangesContext()
  return { hasUnsavedChanges, requestNavigation }
}

type GuardedLinkProps = Omit<ComponentProps<typeof Link>, 'href' | 'onClick'> & {
  href: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

export function GuardedLink({ href, onClick, target, download, ...props }: GuardedLinkProps) {
  const router = useRouter()
  const { hasUnsavedChanges, requestNavigation } = useUnsavedChanges()

  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event)
    const isOwnedSameTabNavigation = href.startsWith('/') && !href.startsWith('//') && (!target || target === '_self') && !download
    if (
      event.defaultPrevented
      || !hasUnsavedChanges
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || !isOwnedSameTabNavigation
    ) return

    event.preventDefault()
    requestNavigation(() => router.push(href))
  }

  return <Link href={href} target={target} download={download} onClick={handleClick} {...props} />
}
