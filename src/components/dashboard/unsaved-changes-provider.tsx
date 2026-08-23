'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
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
  requestNavigation: (proceed: () => void, initiator?: HTMLElement | null) => void
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
  const initiatingElement = useRef<HTMLElement | null>(null)
  const shouldRestoreFocus = useRef(false)

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

  const requestNavigation = useCallback((proceed: () => void, initiator?: HTMLElement | null) => {
    if (!hasUnsavedChanges) {
      proceed()
      return
    }

    initiatingElement.current = initiator ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    shouldRestoreFocus.current = true
    setPendingNavigation(() => proceed)
  }, [hasUnsavedChanges])

  const discardAndProceed = useCallback(() => {
    const proceed = pendingNavigation
    if (!proceed) return

    shouldRestoreFocus.current = false
    setPendingNavigation(null)
    for (const registration of registrations.values()) {
      registration.discard()
    }
    proceed()
  }, [pendingNavigation, registrations])

  const closeDialog = useCallback(() => {
    setPendingNavigation(null)
  }, [])

  const restoreInitiatingFocus = useCallback((event: Event) => {
    event.preventDefault()
    const initiator = initiatingElement.current
    const restore = shouldRestoreFocus.current
    initiatingElement.current = null
    shouldRestoreFocus.current = false

    if (restore && initiator?.isConnected) {
      initiator.focus()
    }
  }, [])

  const value = useMemo<UnsavedChangesContextValue>(() => ({
    hasUnsavedChanges,
    requestNavigation,
    registerDirty,
  }), [hasUnsavedChanges, registerDirty, requestNavigation])

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      <Dialog open={pendingNavigation !== null} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent showCloseButton={false} onCloseAutoFocus={restoreInitiatingFocus}>
          <DialogHeader>
            <DialogTitle>Cambios sin guardar</DialogTitle>
            <DialogDescription>
              Si continúas, se descartarán los cambios que todavía no guardaste.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
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
  onAcceptedNavigation?: () => void
}

export function GuardedLink({ href, onClick, onAcceptedNavigation, target, replace = false, scroll, ...props }: GuardedLinkProps) {
  const router = useRouter()
  const { hasUnsavedChanges, requestNavigation } = useUnsavedChanges()

  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event)
    const isOwnedSameTabNavigation = href.startsWith('/')
      && !href.startsWith('//')
      && (!target || target === '_self')
      && !event.currentTarget.hasAttribute('download')
    if (
      event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
      || !isOwnedSameTabNavigation
    ) return

    if (!hasUnsavedChanges) {
      onAcceptedNavigation?.()
      return
    }

    event.preventDefault()
    requestNavigation(() => {
      onAcceptedNavigation?.()
      const options = scroll === undefined ? undefined : { scroll }
      if (replace) {
        if (options) router.replace(href, options)
        else router.replace(href)
        return
      }
      if (options) router.push(href, options)
      else router.push(href)
    }, event.currentTarget)
  }

  return <Link href={href} target={target} replace={replace} scroll={scroll} onClick={handleClick} {...props} />
}
