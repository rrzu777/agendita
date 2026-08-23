'use client'

import type { BusinessRole } from '@prisma/client'
import { usePathname } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useUnsavedChanges } from '@/components/dashboard/unsaved-changes-provider'
import {
  roleCanUseAnyTour,
  TOUR_CATALOG,
  type TourKey,
  type TourProgressEvent,
} from '@/lib/tours/catalog'
import { getAvailableTours, type AvailableTour } from '@/lib/tours/eligibility'
import {
  getTourProgress,
  recordTourProgress,
  type TourProgressSnapshot,
} from '@/server/actions/tour-progress'
import { isTourDefinitionLoadable, loadTourDefinition } from './tour-definitions'
import {
  DashboardTourContext,
  type DashboardTourContextValue,
  type DashboardTourHelpItem,
} from './tour-context'
import { TourSurface } from './tour-surface'
import { waitForTourTarget } from './tour-target'
import type { TourDefinition, TourStep, TourViewport } from './tour-types'

const MOBILE_VIEWPORT_QUERY = '(max-width: 767px)'
const STEP_PERSISTENCE_DEBOUNCE_MS = 200
const INTERRUPTIVE_SURFACE_SELECTOR = [
  '[data-interruptive-surface][data-state="open"]',
  '[data-interruptive-surface][aria-modal="true"]',
  '[data-slot="dialog-content"]',
  '[data-slot="sheet-content"]',
].join(',')
const LOWER_PRIORITY_SURFACE_SELECTOR =
  '[data-interruptive-surface]:not([data-state="open"]):not([aria-modal="true"])'

function hasOpenInterruptiveSurface(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(INTERRUPTIVE_SURFACE_SELECTOR))
    .some((surface) => surface.closest('[data-tour-surface]') === null)
}

function useInterruptiveSurfaceOpen(enabled: boolean): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const update = () => setOpen(hasOpenInterruptiveSurface())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['aria-modal', 'data-state'],
      childList: true,
      subtree: true,
    })
    return () => observer.disconnect()
  }, [enabled])

  return enabled && open
}

type RuntimeSession = {
  key: TourKey
  definition: TourDefinition
  visibleStepIndexes: number[]
  position: number
  target: HTMLElement | null
  lastTarget: HTMLElement
  replay: boolean
  restoreFocusTo: HTMLElement | null
  generation: number
}

type DashboardTourProviderProps = {
  children: ReactNode
  role: BusinessRole
  onboardingCompleted: boolean
  toursEnabled: boolean
}

function useTourViewport(): TourViewport {
  const [viewport, setViewport] = useState<TourViewport>('desktop')

  useEffect(() => {
    const media = window.matchMedia(MOBILE_VIEWPORT_QUERY)
    const update = () => setViewport(media.matches ? 'mobile' : 'desktop')
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return viewport
}

function stepTargetOptions(step: TourStep, signal: AbortSignal) {
  return {
    targetId: step.targetId,
    fallbackTargetId: step.targetKind === 'data' ? step.fallbackTargetId : undefined,
    waitMs: step.waitMs,
    signal,
  }
}

export function DashboardTourProvider({
  children,
  role,
  onboardingCompleted,
  toursEnabled,
}: DashboardTourProviderProps) {
  const pathname = usePathname()
  const viewport = useTourViewport()
  const { hasUnsavedChanges } = useUnsavedChanges()
  const [progress, setProgress] = useState<TourProgressSnapshot[]>([])
  const [progressKnown, setProgressKnown] = useState(false)
  const [session, setSessionState] = useState<RuntimeSession | null>(null)
  const [pendingStartGeneration, setPendingStartGeneration] = useState<number | null>(null)
  const interruptiveSurfaceOpen = useInterruptiveSurfaceOpen(
    session !== null || pendingStartGeneration !== null,
  )
  const sessionRef = useRef<RuntimeSession | null>(null)
  const mountedRef = useRef(true)
  const sessionGenerationRef = useRef(0)
  const moveGenerationRef = useRef(0)
  const progressGenerationRef = useRef(0)
  const targetAbortRef = useRef<AbortController | null>(null)
  const pendingFocusRef = useRef<HTMLElement | null>(null)
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingStepRef = useRef<number | null>(null)
  const highestScheduledStepRef = useRef(0)
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve())
  const routeRef = useRef(pathname)
  const viewportRef = useRef(viewport)
  const eligibilityRef = useRef({ role, onboardingCompleted, toursEnabled })
  const offeredToursRef = useRef(new Set<string>())

  const setSession = useCallback((next: RuntimeSession | null) => {
    sessionRef.current = next
    setSessionState(next)
  }, [])

  const cancelStepPersistence = useCallback(() => {
    if (persistenceTimerRef.current !== null) {
      clearTimeout(persistenceTimerRef.current)
      persistenceTimerRef.current = null
    }
    pendingStepRef.current = null
  }, [])

  const invalidateSession = useCallback((restoreFocus = true) => {
    const runtime = sessionRef.current
    pendingFocusRef.current = restoreFocus && runtime
      ? (runtime.restoreFocusTo?.isConnected ? runtime.restoreFocusTo : runtime.lastTarget)
      : null
    sessionGenerationRef.current += 1
    moveGenerationRef.current += 1
    targetAbortRef.current?.abort()
    targetAbortRef.current = null
    cancelStepPersistence()
    if (runtime) setSession(null)
  }, [cancelStepPersistence, setSession])

  const enqueuePersistence = useCallback((
    key: TourKey,
    version: number,
    event: TourProgressEvent,
  ) => {
    const task = persistenceQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await recordTourProgress({ key, version, event })
        } catch {
          // La telemetría educativa es best-effort y nunca bloquea producto.
        }
      })
    persistenceQueueRef.current = task
    return task
  }, [])

  const updateLocalProgress = useCallback((snapshot: TourProgressSnapshot) => {
    if (!mountedRef.current) return
    setProgress((current) => [
      ...current.filter((item) => item.key !== snapshot.key || item.version !== snapshot.version),
      snapshot,
    ])
  }, [])

  useEffect(() => {
    const generation = ++progressGenerationRef.current
    if (!toursEnabled || !onboardingCompleted || !roleCanUseAnyTour(role)) return
    void getTourProgress()
      .then((result) => {
        if (!mountedRef.current || generation !== progressGenerationRef.current) return
        if (!result.ok) {
          setProgress([])
          setProgressKnown(false)
          return
        }
        setProgress(result.data)
        setProgressKnown(true)
      })
      .catch(() => {
        if (!mountedRef.current || generation !== progressGenerationRef.current) return
        setProgress([])
        setProgressKnown(false)
      })
  }, [onboardingCompleted, role, toursEnabled])

  const availableTours = useMemo<AvailableTour[]>(() => {
    if (!progressKnown) return []
    return getAvailableTours({
      role,
      pathname,
      onboardingCompleted,
      viewport,
      progress,
      toursEnabled,
    })
  }, [onboardingCompleted, pathname, progress, progressKnown, role, toursEnabled, viewport])

  const helpTours = useMemo<DashboardTourHelpItem[]>(() => {
    if (!progressKnown || !toursEnabled || !onboardingCompleted) return []

    return (Object.keys(TOUR_CATALOG) as TourKey[]).flatMap((key) => {
      const catalog = TOUR_CATALOG[key]
      if (
        !catalog.roles.some((allowedRole) => allowedRole === role)
        || catalog.route !== pathname
        || !isTourDefinitionLoadable(key)
      ) return []

      const snapshot = progress.find((item) => item.key === key && item.version === catalog.version)
      return [{
        key,
        title: catalog.title,
        status: snapshot?.status ?? 'available',
      }]
    })
  }, [onboardingCompleted, pathname, progress, progressKnown, role, toursEnabled])

  const locateTarget = useCallback(async ({
    definition,
    visibleStepIndexes,
    startPosition,
    direction,
    sessionGeneration,
  }: {
    definition: TourDefinition
    visibleStepIndexes: number[]
    startPosition: number
    direction: 1 | -1
    sessionGeneration: number
  }): Promise<{ position: number; target: HTMLElement } | null> => {
    const moveGeneration = ++moveGenerationRef.current
    targetAbortRef.current?.abort()
    const controller = new AbortController()
    targetAbortRef.current = controller

    try {
      for (
        let position = startPosition;
        position >= 0 && position < visibleStepIndexes.length;
        position += direction
      ) {
        const step = definition.steps[visibleStepIndexes[position]]
        const target = await waitForTourTarget(stepTargetOptions(step, controller.signal))
        if (
          !mountedRef.current
          || controller.signal.aborted
          || sessionGeneration !== sessionGenerationRef.current
          || moveGeneration !== moveGenerationRef.current
        ) return null
        if (target) return { position, target }
      }
      return null
    } catch {
      return null
    } finally {
      if (targetAbortRef.current === controller) targetAbortRef.current = null
    }
  }, [])

  const beginSession = useCallback(() => {
    invalidateSession(false)
    const generation = sessionGenerationRef.current
    highestScheduledStepRef.current = 0
    return generation
  }, [invalidateSession])

  const start = useCallback<DashboardTourContextValue['start']>(async (key, options) => {
    const replay = options?.replay === true
    if (!toursEnabled || !onboardingCompleted || hasOpenInterruptiveSurface()) return

    const available = availableTours.find((tour) => tour.key === key)
    const catalog = TOUR_CATALOG[key]
    if (!replay && !available) return
    if (
      replay
      && (catalog.route !== pathname || !catalog.roles.some((allowedRole) => allowedRole === role))
    ) return

    const restoreFocusTo = document.activeElement instanceof HTMLElement
      && document.activeElement !== document.body
      ? document.activeElement
      : null
    const generation = beginSession()
    setPendingStartGeneration(generation)

    try {
      let definition: TourDefinition
      try {
        definition = await loadTourDefinition(key)
      } catch {
        if (generation === sessionGenerationRef.current) invalidateSession()
        return
      }
      if (!mountedRef.current || generation !== sessionGenerationRef.current) return
      if (
        hasOpenInterruptiveSurface()
        || definition.route !== pathname
        || !definition.roles.some((allowedRole) => allowedRole === role)
      ) {
        invalidateSession()
        return
      }

      const visibleStepIndexes = definition.steps.flatMap((step, index) => (
        step.viewports.includes(viewport) ? [index] : []
      ))
      if (visibleStepIndexes.length === 0) {
        invalidateSession()
        return
      }

      const resumeDefinitionIndex = replay ? visibleStepIndexes[0] : (available?.resumeStep ?? visibleStepIndexes[0])
      const resumePosition = Math.max(0, visibleStepIndexes.indexOf(resumeDefinitionIndex))
      highestScheduledStepRef.current = visibleStepIndexes[resumePosition]

      if (!replay) {
        void enqueuePersistence(key, definition.version, { type: 'start' })
      }

      const located = await locateTarget({
        definition,
        visibleStepIndexes,
        startPosition: resumePosition,
        direction: 1,
        sessionGeneration: generation,
      })
      if (!mountedRef.current || generation !== sessionGenerationRef.current) return
      if (!located || hasOpenInterruptiveSurface()) {
        invalidateSession()
        return
      }

      setSession({
        key,
        definition,
        visibleStepIndexes,
        position: located.position,
        target: located.target,
        lastTarget: located.target,
        replay,
        restoreFocusTo,
        generation,
      })
    } finally {
      if (mountedRef.current) {
        setPendingStartGeneration((current) => current === generation ? null : current)
      }
    }
  }, [
    availableTours,
    beginSession,
    enqueuePersistence,
    invalidateSession,
    locateTarget,
    onboardingCompleted,
    pathname,
    role,
    setSession,
    toursEnabled,
    viewport,
  ])

  const offer = useCallback<DashboardTourContextValue['offer']>(async (key) => {
    const available = availableTours.find((tour) => tour.key === key)
    if (!available) return
    const identity = `${key}:${available.version}`
    if (offeredToursRef.current.has(identity)) return
    offeredToursRef.current.add(identity)
    await enqueuePersistence(key, available.version, { type: 'offer' })
  }, [availableTours, enqueuePersistence])

  const scheduleStepPersistence = useCallback((runtime: RuntimeSession, step: number) => {
    if (runtime.replay || step <= highestScheduledStepRef.current) return
    highestScheduledStepRef.current = step
    pendingStepRef.current = step
    if (persistenceTimerRef.current !== null) clearTimeout(persistenceTimerRef.current)
    persistenceTimerRef.current = setTimeout(() => {
      persistenceTimerRef.current = null
      const pendingStep = pendingStepRef.current
      pendingStepRef.current = null
      if (
        pendingStep === null
        || !mountedRef.current
        || runtime.generation !== sessionGenerationRef.current
      ) return
      updateLocalProgress({
        key: runtime.key,
        version: runtime.definition.version,
        status: 'in_progress',
        lastStep: pendingStep,
      })
      void enqueuePersistence(runtime.key, runtime.definition.version, { type: 'step', step: pendingStep })
    }, STEP_PERSISTENCE_DEBOUNCE_MS)
  }, [enqueuePersistence, updateLocalProgress])

  const next = useCallback<DashboardTourContextValue['next']>(async () => {
    const runtime = sessionRef.current
    if (!runtime || hasUnsavedChanges || interruptiveSurfaceOpen) return

    if (runtime.position >= runtime.visibleStepIndexes.length - 1) {
      const finalStep = runtime.visibleStepIndexes[runtime.position]
      const { key, definition, replay } = runtime
      cancelStepPersistence()
      invalidateSession()
      if (!replay) {
        updateLocalProgress({
          key,
          version: definition.version,
          status: 'completed',
          lastStep: Math.max(highestScheduledStepRef.current, finalStep),
        })
        await enqueuePersistence(key, definition.version, { type: 'step', step: finalStep })
        await enqueuePersistence(key, definition.version, { type: 'complete' })
      }
      return
    }

    setSession({ ...runtime, target: null })
    const located = await locateTarget({
      definition: runtime.definition,
      visibleStepIndexes: runtime.visibleStepIndexes,
      startPosition: runtime.position + 1,
      direction: 1,
      sessionGeneration: runtime.generation,
    })
    if (!mountedRef.current || runtime.generation !== sessionGenerationRef.current) return
    if (!located) {
      invalidateSession()
      return
    }

    const nextSession = {
      ...runtime,
      position: located.position,
      target: located.target,
      lastTarget: located.target,
    }
    setSession(nextSession)
    scheduleStepPersistence(nextSession, runtime.visibleStepIndexes[located.position])
  }, [
    cancelStepPersistence,
    enqueuePersistence,
    hasUnsavedChanges,
    invalidateSession,
    locateTarget,
    scheduleStepPersistence,
    setSession,
    interruptiveSurfaceOpen,
    updateLocalProgress,
  ])

  const previous = useCallback<DashboardTourContextValue['previous']>(() => {
    const runtime = sessionRef.current
    if (!runtime || runtime.position === 0 || hasUnsavedChanges || interruptiveSurfaceOpen) return
    const previousTarget = runtime.target
    setSession({ ...runtime, target: null })

    void locateTarget({
      definition: runtime.definition,
      visibleStepIndexes: runtime.visibleStepIndexes,
      startPosition: runtime.position - 1,
      direction: -1,
      sessionGeneration: runtime.generation,
    }).then((located) => {
      if (!mountedRef.current || runtime.generation !== sessionGenerationRef.current) return
      if (!located) {
        if (previousTarget?.isConnected) setSession({ ...runtime, target: previousTarget })
        else invalidateSession()
        return
      }
      setSession({
        ...runtime,
        position: located.position,
        target: located.target,
        lastTarget: located.target,
      })
    })
  }, [hasUnsavedChanges, interruptiveSurfaceOpen, invalidateSession, locateTarget, setSession])

  const dismiss = useCallback<DashboardTourContextValue['dismiss']>(async (requestedKey) => {
    const runtime = sessionRef.current
    if (!runtime) {
      const available = availableTours.find((tour) => tour.key === requestedKey)
      if (!available) return
      updateLocalProgress({
        key: available.key,
        version: available.version,
        status: 'dismissed',
        lastStep: available.resumeStep,
      })
      await enqueuePersistence(available.key, available.version, { type: 'dismiss' })
      return
    }
    if (requestedKey && runtime.key !== requestedKey) return
    const { key, definition, replay, visibleStepIndexes, position } = runtime
    const pendingStep = pendingStepRef.current
    cancelStepPersistence()
    invalidateSession()
    if (replay) return

    updateLocalProgress({
      key,
      version: definition.version,
      status: 'dismissed',
      lastStep: Math.max(highestScheduledStepRef.current, visibleStepIndexes[position]),
    })
    if (pendingStep !== null) {
      await enqueuePersistence(key, definition.version, { type: 'step', step: pendingStep })
    }
    await enqueuePersistence(key, definition.version, { type: 'dismiss' })
  }, [availableTours, cancelStepPersistence, enqueuePersistence, invalidateSession, updateLocalProgress])

  const closeReplay = useCallback<DashboardTourContextValue['closeReplay']>(() => {
    if (sessionRef.current?.replay) invalidateSession()
  }, [invalidateSession])

  const failOpen = useCallback(() => {
    invalidateSession()
  }, [invalidateSession])

  useEffect(() => {
    if (routeRef.current === pathname) return
    routeRef.current = pathname
    invalidateSession()
  }, [invalidateSession, pathname])

  useEffect(() => {
    if (viewportRef.current === viewport) return
    viewportRef.current = viewport
    invalidateSession()
  }, [invalidateSession, viewport])

  useEffect(() => {
    const previous = eligibilityRef.current
    if (
      previous.role === role
      && previous.onboardingCompleted === onboardingCompleted
      && previous.toursEnabled === toursEnabled
    ) return

    eligibilityRef.current = { role, onboardingCompleted, toursEnabled }
    invalidateSession()
  }, [invalidateSession, onboardingCompleted, role, toursEnabled])

  useEffect(() => {
    if (session) return
    const focusTarget = pendingFocusRef.current
    pendingFocusRef.current = null
    if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true })
  }, [session])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      progressGenerationRef.current += 1
      sessionGenerationRef.current += 1
      moveGenerationRef.current += 1
      targetAbortRef.current?.abort()
      targetAbortRef.current = null
      cancelStepPersistence()
    }
  }, [cancelStepPersistence])

  const value = useMemo<DashboardTourContextValue>(() => ({
    available: availableTours.map((tour) => tour.key),
    helpTours,
    active: session
      ? { key: session.key, step: session.visibleStepIndexes[session.position] }
      : null,
    start,
    next,
    previous,
    dismiss,
    offer,
    closeReplay,
  }), [availableTours, closeReplay, dismiss, helpTours, next, offer, previous, session, start])

  const activeStep = session?.definition.steps[session.visibleStepIndexes[session.position]]

  return (
    <DashboardTourContext.Provider value={value}>
      <div className="contents" data-tour-active={session ? '' : undefined}>
        {children}
        {session && (
          <style>{`[data-tour-active] ${LOWER_PRIORITY_SURFACE_SELECTOR} { display: none !important; }`}</style>
        )}
      </div>
      {!interruptiveSurfaceOpen && session?.target && activeStep && (
        <TourSurface
          step={activeStep}
          stepNumber={session.position + 1}
          totalSteps={session.visibleStepIndexes.length}
          viewport={viewport}
          target={session.target}
          paused={hasUnsavedChanges || interruptiveSurfaceOpen}
          canGoPrevious={session.position > 0}
          isLastStep={session.position === session.visibleStepIndexes.length - 1}
          restoreFocusTo={session.restoreFocusTo}
          restoreFocusOnUnmount={false}
          onFailure={failOpen}
          onPrevious={previous}
          onNext={next}
          onDismiss={dismiss}
        />
      )}
    </DashboardTourContext.Provider>
  )
}

export { useDashboardTours } from './tour-context'
