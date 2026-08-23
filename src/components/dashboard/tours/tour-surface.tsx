'use client'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { TourStep, TourViewport } from './tour-types'

export type TourSurfaceProps = {
  step: TourStep
  stepNumber: number
  totalSteps: number
  viewport: TourViewport
  target: HTMLElement
  paused?: boolean
  canGoPrevious: boolean
  isLastStep: boolean
  restoreFocusTo?: HTMLElement | null
  restoreFocusOnUnmount?: boolean
  onFailure?: () => void
  onPrevious: () => void
  onNext: () => void | Promise<void>
  onDismiss: () => void | Promise<void>
}

function readTargetRect(target: HTMLElement): DOMRect | null {
  if (!target.isConnected) return null
  try {
    for (let current: HTMLElement | null = target; current; current = current.parentElement) {
      const style = window.getComputedStyle(current)
      if (style.display === 'none' || style.visibility === 'hidden') return null
    }

    const rect = target.getBoundingClientRect()
    return [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
      && rect.width > 0
      && rect.height > 0
      ? rect
      : null
  } catch {
    return null
  }
}

const TOUR_SURFACE_MUTATION_SELECTOR = [
  '[data-tour-surface]',
  '[data-slot="sheet-overlay"]',
  '[data-radix-focus-guard]',
].join(',')

function isTourSurfaceMutation(record: MutationRecord): boolean {
  if (
    record.target instanceof Element
    && record.target.closest(TOUR_SURFACE_MUTATION_SELECTOR)
  ) return true

  const changedNodes = [...record.addedNodes, ...record.removedNodes]
  return changedNodes.length > 0 && changedNodes.every((node) => {
    if (!(node instanceof Element)) {
      return node.parentElement?.closest(TOUR_SURFACE_MUTATION_SELECTOR) !== null
    }
    return node.matches(TOUR_SURFACE_MUTATION_SELECTOR)
      || node.closest(TOUR_SURFACE_MUTATION_SELECTOR) !== null
      || node.querySelector(TOUR_SURFACE_MUTATION_SELECTOR) !== null
  })
}

function useTargetRect(target: HTMLElement, onFailure: () => void) {
  const targetRect = useMemo(() => readTargetRect(target), [target])
  const [measurement, setMeasurement] = useState(() => ({ target, rect: targetRect }))
  const frame = useRef<number | null>(null)

  useEffect(() => {
    let active = true
    let resizeObserver: ResizeObserver | null = null
    let removalObserver: MutationObserver | null = null
    const cleanup = () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      resizeObserver?.disconnect()
      removalObserver?.disconnect()
      if (frame.current !== null) {
        window.cancelAnimationFrame(frame.current)
        frame.current = null
      }
    }
    const failOpen = () => {
      if (!active) return
      active = false
      cleanup()
      onFailure()
    }
    const update = () => {
      if (frame.current !== null) return
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null
        if (!active) return
        const rect = readTargetRect(target)
        if (!rect) {
          failOpen()
          return
        }
        setMeasurement({ target, rect })
      })
    }

    if (!targetRect) {
      failOpen()
      return cleanup
    }

    try {
      resizeObserver = new ResizeObserver(update)
      removalObserver = new MutationObserver((records) => {
        const targetVisibilityChanged = records.some((record) => (
          record.type === 'attributes'
          && record.target instanceof HTMLElement
          && record.target !== document.body
          && record.target !== document.documentElement
          && (record.target === target || record.target.contains(target))
        ))
        const externalLayoutChanged = records.some((record) => (
          (record.type === 'childList' || record.type === 'attributes')
          && !isTourSurfaceMutation(record)
        ))
        if (target.isConnected && !targetVisibilityChanged && !externalLayoutChanged) return
        if (!readTargetRect(target)) {
          failOpen()
          return
        }
        update()
      })
      window.addEventListener('resize', update)
      window.addEventListener('scroll', update, true)
      resizeObserver.observe(target)
      removalObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'hidden', 'style'],
        childList: true,
        subtree: true,
      })
    } catch {
      failOpen()
    }

    return () => {
      active = false
      cleanup()
    }
  }, [onFailure, target, targetRect])

  return measurement.target === target ? measurement.rect : targetRect
}

type TourCardProps = Pick<
  TourSurfaceProps,
  'step' | 'stepNumber' | 'totalSteps' | 'paused' | 'canGoPrevious' | 'isLastStep' | 'onPrevious' | 'onNext' | 'onDismiss'
> & {
  confirmingDismiss: boolean
  titleId: string
  descriptionId: string
  onContinue: () => void
  mobile: boolean
}

function TourCard({
  step,
  stepNumber,
  totalSteps,
  paused,
  canGoPrevious,
  isLastStep,
  onPrevious,
  onNext,
  onDismiss,
  confirmingDismiss,
  titleId,
  descriptionId,
  onContinue,
  mobile,
}: TourCardProps) {
  const Header = mobile ? SheetHeader : PopoverHeader
  const Title = mobile ? SheetTitle : PopoverTitle
  const Description = mobile ? SheetDescription : PopoverDescription
  const Footer = mobile ? SheetFooter : 'div'

  return (
    <>
      <Header className={mobile ? undefined : 'p-1'}>
        <Title id={titleId} role={mobile ? undefined : 'heading'} aria-level={mobile ? undefined : 2}>
          {confirmingDismiss ? '¿Omitir este recorrido?' : step.title}
        </Title>
        <Description id={descriptionId}>
          {confirmingDismiss
            ? 'Puedes volver a iniciarlo más adelante desde Ayuda y recorridos.'
            : step.body}
        </Description>
      </Header>

      {!confirmingDismiss && (
        <div className={mobile ? 'px-4' : 'px-1'}>
          <p aria-label={`Paso ${stepNumber} de ${totalSteps}`} aria-live="polite" className="text-xs font-medium text-muted-foreground">
            Paso {stepNumber} de {totalSteps}
          </p>
          {paused && (
            <p role="status" className="mt-2 rounded-md bg-muted p-2 text-sm text-foreground">
              Termina o descarta tus cambios para continuar
            </p>
          )}
        </div>
      )}

      <Footer className={mobile ? undefined : 'flex flex-wrap justify-end gap-2 p-1'}>
        {confirmingDismiss ? (
          <>
            <Button type="button" variant="outline" onClick={onContinue}>
              Seguir recorrido
            </Button>
            <Button type="button" variant="destructive" onClick={() => { void onDismiss() }}>
              Omitir recorrido
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={() => { void onDismiss() }}>
              Omitir recorrido
            </Button>
            <Button type="button" variant="outline" disabled={!canGoPrevious || paused} onClick={onPrevious}>
              Atrás
            </Button>
            <Button type="button" disabled={paused} onClick={() => { void onNext() }}>
              {isLastStep ? 'Terminar' : 'Siguiente'}
            </Button>
          </>
        )}
      </Footer>
    </>
  )
}

export function TourSurface(props: TourSurfaceProps) {
  const {
    target,
    viewport,
    restoreFocusTo,
    restoreFocusOnUnmount = true,
    onFailure,
  } = props
  const [failed, setFailed] = useState(false)
  const failOpen = useCallback(() => {
    setFailed(true)
    onFailure?.()
  }, [onFailure])
  const rect = useTargetRect(target, failOpen)
  const [confirmingDismiss, setConfirmingDismiss] = useState(false)
  const reactId = useId()
  const titleId = `tour-title-${reactId}`
  const descriptionId = `tour-description-${reactId}`
  const restoreFocusRef = useRef(restoreFocusTo)
  const restoreFocusOnUnmountRef = useRef(restoreFocusOnUnmount)
  const targetRef = useRef(target)

  useEffect(() => {
    restoreFocusRef.current = restoreFocusTo
    restoreFocusOnUnmountRef.current = restoreFocusOnUnmount
    targetRef.current = target
  }, [restoreFocusOnUnmount, restoreFocusTo, target])

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    try {
      target.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest',
      })
    } catch {
      // El recorrido es ayuda secundaria: un fallo de scroll nunca bloquea la UI.
    }
  }, [target, props.step.id])

  useEffect(() => () => {
    if (!restoreFocusOnUnmountRef.current) return
    const focusTarget = restoreFocusRef.current?.isConnected
      ? restoreFocusRef.current
      : targetRef.current
    if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true })
  }, [])

  const requestClose = useCallback((open: boolean) => {
    if (!open) setConfirmingDismiss(true)
  }, [])
  const requestEscapeClose = useCallback((event: KeyboardEvent) => {
    event.preventDefault()
    setConfirmingDismiss(true)
  }, [])
  const continueTour = useCallback(() => setConfirmingDismiss(false), [])
  const cardProps = {
    ...props,
    confirmingDismiss,
    titleId,
    descriptionId,
    onContinue: continueTour,
  }

  if (failed || !rect) return null

  const highlightStyle = {
    left: rect.left - 4,
    top: rect.top - 4,
    width: rect.width + 8,
    height: rect.height + 8,
  }

  return (
    <>
      <div
        data-tour-highlight
        data-tour-surface=""
        aria-hidden="true"
        className="pointer-events-none fixed z-[55] rounded-xl border-2 border-primary ring-4 ring-primary/20"
        style={highlightStyle}
      />
      {viewport === 'desktop' ? (
        <Popover open>
          <PopoverAnchor asChild>
            <div
              data-tour-anchor
              data-tour-surface=""
              aria-hidden="true"
              className="pointer-events-none fixed"
              style={{
                left: rect.left + rect.width / 2,
                top: rect.top + rect.height / 2,
                width: 1,
                height: 1,
              }}
            />
          </PopoverAnchor>
          <PopoverContent
            data-tour-surface=""
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="pointer-events-auto z-[60] w-[min(22rem,calc(100vw-2rem))]"
            onEscapeKeyDown={requestEscapeClose}
          >
            <TourCard {...cardProps} mobile={false} />
          </PopoverContent>
        </Popover>
      ) : (
        <Sheet open onOpenChange={requestClose}>
          <SheetContent
            data-tour-surface=""
            side="bottom"
            showCloseButton={false}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="z-[60] max-h-[85dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
            onEscapeKeyDown={requestEscapeClose}
          >
            <TourCard {...cardProps} mobile />
          </SheetContent>
        </Sheet>
      )}
    </>
  )
}
