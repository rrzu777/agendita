'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [draftReady, setDraftReady] = useState(false)
  const verifiedSignature = useRef<string | null>(null)
  const verificationInFlight = useRef<{
    signature: string
    promise: ReturnType<typeof verifySettingsDraftBaseline>
  } | null>(null)
  const wasDirty = useRef(false)

  const clearDraft = useCallback(() => {
    const storage = getSessionStorage()
    if (storage) clearSettingsDraft(storage, key)
  }, [key])

  const verifyStoredDraft = useCallback(async (force: boolean) => {
    const storage = getSessionStorage()
    if (!storage) {
      setRecovery('none')
      setDraftReady(true)
      return
    }

    const candidate = readSettingsDraftCandidate<T>(storage, key, version)
    if (candidate.kind === 'none') {
      setRecovery('none')
      setDraftReady(true)
      return
    }

    const storedFingerprint = await settingsFingerprint(candidate.baseline)
    const signature = `${key}:${version}:${storedFingerprint}`
    if (!force && verifiedSignature.current === signature) return
    verifiedSignature.current = signature

    const existingVerification = verificationInFlight.current
    const verification = existingVerification?.signature === signature
      ? existingVerification
      : {
          signature,
          promise: verifySettingsDraftBaseline(scope, storedFingerprint),
        }
    verificationInFlight.current = verification

    try {
      const result = await verification.promise
      if (result.matches) {
        reset(candidate.values, { keepDefaultValues: true })
        setRecovery('restored')
      } else {
        replaceBaseline(result.current as T)
        setRecovery('conflict')
      }
    } catch {
      setRecovery('verification-failed')
    } finally {
      if (verificationInFlight.current === verification) verificationInFlight.current = null
      setDraftReady(true)
    }
  }, [key, replaceBaseline, reset, scope, version])

  useEffect(() => {
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
      window.removeEventListener('popstate', restoreFromPopState)
      window.removeEventListener('pageshow', restoreFromPageShow)
    }
  }, [verifyStoredDraft])

  useEffect(() => {
    if (!draftReady) return

    const storage = getSessionStorage()
    if (!storage) return

    if (isDirty) {
      writeSettingsDraft(storage, key, version, baseline, values)
      wasDirty.current = true
      return
    }

    if (wasDirty.current) {
      clearSettingsDraft(storage, key)
      wasDirty.current = false
    }
  }, [baseline, draftReady, isDirty, key, values, version])

  const discard = useCallback(() => {
    clearDraft()
    wasDirty.current = false
    reset(baseline)
  }, [baseline, clearDraft, reset])

  return { recovery, discard, clearDraft }
}
