'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  clearSettingsDraft,
  readSettingsDraftCandidate,
  settingsFingerprint,
  writeSettingsDraft,
  type FlatSettings,
} from '@/lib/business/settings-draft'
import { verifySettingsDraftBaseline } from '@/server/actions/settings-draft-verifier'
import type { SettingsDraftScope } from '@/lib/business/settings-form-values'

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function flatSignature(values: FlatSettings) {
  return Object.keys(values)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(values[key])}`)
    .join('|')
}

function getStoredDraftRaw(storage: Storage, key: string) {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

export function useSettingsDraft<T extends FlatSettings>({
  scope,
  key,
  version,
  baseline,
  values,
  isDirty,
  reset,
  replaceBaseline,
}: {
  scope: SettingsDraftScope
  key: string
  version: number
  baseline: T
  values: T
  isDirty: boolean
  reset: (values: T, options?: { keepDefaultValues?: boolean }) => void
  replaceBaseline: (values: T) => void
}) {
  const [recovery, setRecovery] = useState<'none' | 'restored' | 'conflict' | 'verification-failed'>('none')
  const mounted = useRef(false)
  const generation = useRef(0)
  const valuesSignature = flatSignature(values)
  const latestValuesSignature = useRef(valuesSignature)
  const persistenceReady = useRef(false)
  const preservedCandidate = useRef<string | null>(null)
  const verificationInFlight = useRef<{
    candidateRaw: string
    valuesSignature: string
    promise: ReturnType<typeof verifySettingsDraftBaseline>
  } | null>(null)
  const wasDirty = useRef(false)

  useLayoutEffect(() => {
    if (latestValuesSignature.current === valuesSignature) return
    latestValuesSignature.current = valuesSignature
    generation.current += 1
    persistenceReady.current = true
  }, [valuesSignature])

  const clearDraft = useCallback(() => {
    generation.current += 1
    preservedCandidate.current = null
    persistenceReady.current = true
    wasDirty.current = false
    const storage = getSessionStorage()
    if (storage) clearSettingsDraft(storage, key)
  }, [key])

  const verifyStoredDraft = useCallback(async (force: boolean) => {
    const requestGeneration = generation.current + 1
    generation.current = requestGeneration
    const requestValuesSignature = latestValuesSignature.current
    const storage = getSessionStorage()
    if (!storage) {
      if (mounted.current && generation.current === requestGeneration) {
        persistenceReady.current = true
        setRecovery('none')
      }
      return
    }

    const candidateRaw = getStoredDraftRaw(storage, key)
    const candidate = readSettingsDraftCandidate<T>(storage, key, version)
    if (candidate.kind === 'none' || candidateRaw === null) {
      if (mounted.current && generation.current === requestGeneration) {
        persistenceReady.current = true
        setRecovery('none')
      }
      return
    }

    const storedFingerprint = await settingsFingerprint(candidate.baseline)
    const isCurrentRequest = () => (
      mounted.current
      && generation.current === requestGeneration
      && latestValuesSignature.current === requestValuesSignature
      && getStoredDraftRaw(storage, key) === candidateRaw
    )
    if (!isCurrentRequest()) return

    const existingVerification = verificationInFlight.current
    const verification = !force
      && existingVerification?.candidateRaw === candidateRaw
      && existingVerification.valuesSignature === requestValuesSignature
      ? existingVerification
      : {
          candidateRaw,
          valuesSignature: requestValuesSignature,
          promise: verifySettingsDraftBaseline(scope, storedFingerprint),
        }
    verificationInFlight.current = verification

    try {
      const result = await verification.promise
      if (!isCurrentRequest()) return

      preservedCandidate.current = candidateRaw
      wasDirty.current = false
      persistenceReady.current = true
      replaceBaseline(result.current as T)
      if (result.matches) {
        reset(candidate.values, { keepDefaultValues: true })
        setRecovery('restored')
      } else {
        setRecovery('conflict')
      }
    } catch {
      if (isCurrentRequest()) {
        persistenceReady.current = true
        setRecovery('verification-failed')
      }
    } finally {
      if (verificationInFlight.current === verification) verificationInFlight.current = null
    }
  }, [key, replaceBaseline, reset, scope, version])

  useEffect(() => {
    mounted.current = true
    // Verification is asynchronous whenever a recoverable draft exists; the
    // synchronous no-draft path only unlocks persistence for this mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void verifyStoredDraft(false)

    const restoreFromPopState = () => {
      void verifyStoredDraft(true)
    }
    const restoreFromPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void verifyStoredDraft(true)
    }

    window.addEventListener('popstate', restoreFromPopState)
    window.addEventListener('pageshow', restoreFromPageShow)
    return () => {
      mounted.current = false
      generation.current += 1
      window.removeEventListener('popstate', restoreFromPopState)
      window.removeEventListener('pageshow', restoreFromPageShow)
    }
  }, [verifyStoredDraft])

  useEffect(() => {
    if (!persistenceReady.current) return

    const storage = getSessionStorage()
    if (!storage) return

    if (preservedCandidate.current !== null) {
      const stillPreserved = getStoredDraftRaw(storage, key) === preservedCandidate.current
      preservedCandidate.current = null
      if (stillPreserved) {
        wasDirty.current = isDirty
        return
      }
    }

    if (isDirty) {
      writeSettingsDraft(storage, key, version, baseline, values)
      wasDirty.current = true
      return
    }

    if (wasDirty.current) {
      clearSettingsDraft(storage, key)
      wasDirty.current = false
    }
  }, [baseline, isDirty, key, values, version])

  const discard = useCallback(() => {
    clearDraft()
    wasDirty.current = false
    reset(baseline)
  }, [baseline, clearDraft, reset])

  return { recovery, discard, clearDraft }
}
