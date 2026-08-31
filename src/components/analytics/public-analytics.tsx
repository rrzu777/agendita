'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createAnalyticsStore, type AnalyticsDraft, type AnalyticsStore, type SelectionChange } from '@/lib/analytics/client-store'
import { createAnalyticsTransport, type TransportOptions } from '@/lib/analytics/client-transport'
import { publicAcquisitionSearch } from '@/lib/business/urls'

interface PublicCapture {
  ready: boolean
  track(event: AnalyticsDraft, binding?: string): void
  changeSelection(change: SelectionChange): void
  startAttempt(kind: 'complete' | 'partial'): void
  bookingCredential(): { credential: string; selectionRevision?: number } | undefined
  completeAttempt(): string | undefined
  withdrawConsent(): void
  revision(): number
  attemptIdentity(): string | null
  nextAvailabilityGeneration(): number | null
  rememberSelection(signature: string): void
  reconcileSelection(signature: string): void
}
const noop = () => {}
const disabled: PublicCapture = { ready: false, track: noop, changeSelection: noop, startAttempt: noop, bookingCredential: () => undefined, completeAttempt: () => undefined, withdrawConsent: noop, revision: () => 1, attemptIdentity: () => null, nextAvailabilityGeneration: () => null, rememberSelection: noop, reconcileSelection: noop }
const Context = createContext<PublicCapture>(disabled)
export function usePublicAnalytics() { return useContext(Context) }

function acquisition(): TransportOptions['acquisition'] {
  const search = new URLSearchParams(publicAcquisitionSearch(new URLSearchParams(window.location.search)))
  const result: NonNullable<TransportOptions['acquisition']> = {}
  for (const [query, key] of [['acq', 'acq'], ['utm_source', 'utmSource'], ['utm_medium', 'utmMedium'], ['utm_campaign', 'utmCampaign']] as const) {
    const value = search.get(query)
    if (value) result[key] = value
  }
  try { if (document.referrer) result.referrerHost = new URL(document.referrer).hostname } catch { /* no free text fallback */ }
  return result
}

/** Small nonblocking preference card; never shares Booking's contractual checkbox. */
export function PublicAnalytics({ children, businessId, slug, eligible, surface }: { children: ReactNode; businessId: string; slug: string; timezone: string; eligible: boolean; surface: 'booking' | 'profile' }) {
  const store = useRef<AnalyticsStore | null>(null)
  const transport = useRef<ReturnType<typeof createAnalyticsTransport> | null>(null)
  const release = useRef<(() => void) | null>(null)
  const writer = useRef(false)
  const completed = useRef(false)
  const completedBinding = useRef<string | undefined>(undefined)
  const [choice, setChoice] = useState<boolean | null>(null)
  const [consentReady, setConsentReady] = useState(false)
  const [ready, setReady] = useState(false)
  const [revision, setRevision] = useState(1)
  const [captureIdentity, setCaptureIdentity] = useState<string | null>(null)

  useEffect(() => {
    if (!eligible) return
    let disposed = false
    completed.current = false
    completedBinding.current = undefined
    try {
      store.current = createAnalyticsStore({ businessId, origin: window.location.origin, storage: window.sessionStorage, preferences: window.localStorage })
      if (store.current.consent() !== true) store.current.discardState()
      setChoice(store.current.consent())
    } catch { store.current = null }
    queueMicrotask(() => { if (!disposed && store.current) setConsentReady(true) })
    return () => { disposed = true; writer.current = false; transport.current?.stop(); release.current?.(); store.current?.stop() }
  }, [businessId, eligible])

  useEffect(() => {
    function synchronize(event: StorageEvent) {
      const current = store.current
      if (!current || event.key !== current.keys.preference) return
      const allowed = current.consent()
      if (allowed !== true) {
        writer.current = false; transport.current?.stop(); release.current?.()
        completedBinding.current = undefined
        current.discardState(); setReady(false)
      }
      setChoice(allowed)
    }
    window.addEventListener('storage', synchronize)
    return () => window.removeEventListener('storage', synchronize)
  }, [])

  useEffect(() => {
    const current = store.current
    if (!eligible || choice !== true || !current || !navigator.locks) return
    if (!current.open()) return
    const owner = current.snapshot()?.owner
    if (!owner) return
    let disposed = false
    // A cloned tab has the same owner. Web Locks is origin-wide and cannot grant both.
    // No Lock API / unavailable lock means no capture, not a timestamp-based pseudo-lock.
    void navigator.locks.request(`owner-analytics:${owner}`, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock || disposed) return
      writer.current = true
      transport.current = createAnalyticsTransport(current, slug, { acquisition: acquisition() })
      setRevision(current.snapshot()?.revision ?? 1)
      setCaptureIdentity(current.snapshot()?.active ?? null)
      setReady(true)
      await new Promise<void>((resolve) => { release.current = resolve })
      writer.current = false
    }).catch(() => {})
    return () => { disposed = true; writer.current = false; transport.current?.stop(); release.current?.() }
  }, [businessId, choice, eligible, slug])

  useEffect(() => {
    if (!ready) return
    function visible() {
      if (document.visibilityState === 'visible' && writer.current) store.current?.view({ type: surface === 'profile' ? 'public_profile_viewed' : 'booking_entry_viewed', data: {} }, surface)
      void transport.current?.flush()
    }
    visible()
    const interval = setInterval(() => { void transport.current?.flush() }, 5000)
    document.addEventListener('visibilitychange', visible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', visible) }
  }, [ready, surface])

  function choose(allowed: boolean) {
    const current = store.current
    if (!current) return
    if (!allowed) { writer.current = false; transport.current?.stop(); release.current?.(); completedBinding.current = undefined; setReady(false) }
    current.chooseConsent(allowed)
    setChoice(allowed)
  }
  const api = useMemo<PublicCapture>(() => {
    const active = () => writer.current ? store.current : null
    const publishRevision = () => {
      const snapshot = active()?.snapshot()
      setRevision(snapshot?.revision ?? 1)
      setCaptureIdentity(snapshot?.active ?? null)
    }
    return {
      ready,
      track: (event, binding) => { if (document.visibilityState === 'visible') active()?.track(event, binding) },
      changeSelection: (change) => {
        if (completed.current) {
          // Only an explicit new booking selection rearms this mounted flow.
          // Restore/visibility/payment preparation must not count checkout retries as new attempts.
          if (change.reason === 'restore' || change.reason === 'payment') return
          completed.current = false
          completedBinding.current = undefined
          active()?.startAttempt('partial')
        }
        active()?.changeSelection(change)
        publishRevision()
      },
      startAttempt: (kind) => { if (!completed.current && document.visibilityState === 'visible') { active()?.startAttempt(kind); publishRevision() } },
      bookingCredential: () => active()?.bookingCredential(),
      completeAttempt: () => {
        completed.current = true
        const binding = active()?.completeAttempt()
        publishRevision()
        if (binding) completedBinding.current = binding
        // An idempotent Booking retry may reach checkout later in this same flow.
        return completedBinding.current
      },
      withdrawConsent: () => choose(false),
      revision: () => active()?.snapshot()?.revision ?? 1,
      attemptIdentity: () => active()?.snapshot()?.active ?? null,
      nextAvailabilityGeneration: () => active()?.nextAvailabilityGeneration() ?? null,
      rememberSelection: (signature) => { active()?.rememberSelection(signature) },
      reconcileSelection: (signature) => { if (!completed.current) { active()?.reconcileSelection(signature); publishRevision() } },
    }
    // Identity/revision changes restart pending observations; refs guard ownership synchronously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, revision, captureIdentity])

  return <Context value={api}>
    {children}
    {eligible && <aside aria-label="Preferencias de métricas" className="mx-auto my-6 max-w-2xl rounded-2xl border border-border bg-card p-5 text-sm text-primary">
      {choice === null ? <>
        <h2 className="font-heading text-base font-semibold">Métricas opcionales de esta reserva</h2>
        <p className="mt-2 text-muted-foreground">Puedes ayudar al negocio a entender el recorrido de reserva. Son datos seudónimos, vinculables a la reserva; no incluimos tus datos de contacto. Se conservan hasta 90 días, con hasta 24 horas adicionales para eliminarlos. Puedes reservar sin permitir métricas.</p>
        <div className="mt-4 flex flex-wrap gap-3">{[['Permitir métricas', true], ['Continuar sin métricas', false]].map(([label, allowed]) => <button key={String(label)} type="button" disabled={!consentReady} onClick={() => choose(allowed === true)} className="min-h-11 flex-1 rounded-full border border-border px-4 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{label}</button>)}</div>
      </> : <>
        <p>{choice ? 'Métricas permitidas para este negocio.' : 'Métricas no permitidas para este negocio.'} Esta preferencia dura 180 días.</p>
        <button type="button" className="mt-2 min-h-11 font-semibold underline focus-visible:outline-2" onClick={() => choice ? choose(false) : setChoice(null)}>{choice ? 'Retirar permiso de métricas' : 'Cambiar preferencia de métricas'}</button>
        {choice && <p className="text-muted-foreground">Retirar el permiso elimina los identificadores locales y detiene los envíos; no borra retroactivamente los datos enviados.</p>}
      </>}
    </aside>}
  </Context>
}
