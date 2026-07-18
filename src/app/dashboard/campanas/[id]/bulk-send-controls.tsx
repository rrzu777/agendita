'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Mail, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { sendCampaignEmailBatch, sendCampaignMessage } from '@/server/actions/campaigns'
import type { RecipientItem } from './recipient-list'

const EMAIL_CHUNK = 10

/** Solo pendientes contactables por cada canal (no opt-out, no enviadas). */
function pendingByChannel(recipients: RecipientItem[]) {
  const email = recipients.filter((r) => !r.optedOut && r.channel === 'email' && !r.sentAt)
  const whatsapp = recipients.filter((r) => !r.optedOut && r.channel === 'whatsapp' && !r.sentAt)
  return { email, whatsapp }
}

export function BulkSendControls({
  campaignId,
  recipients,
}: {
  campaignId: string
  recipients: RecipientItem[]
}) {
  const router = useRouter()
  const { email, whatsapp } = useMemo(() => pendingByChannel(recipients), [recipients])

  // ── Email masivo por tandas ──────────────────────────────────────────────
  const [emailRunning, setEmailRunning] = useState(false)
  const [emailDone, setEmailDone] = useState(0)
  const [emailFailed, setEmailFailed] = useState<string[]>([])

  async function runEmailBulk() {
    setEmailRunning(true)
    setEmailDone(0)
    setEmailFailed([])
    const ids = email.map((r) => r.id)
    const failed: string[] = []
    let done = 0
    try {
      for (let i = 0; i < ids.length; i += EMAIL_CHUNK) {
        const chunk = ids.slice(i, i + EMAIL_CHUNK)
        const { results } = await sendCampaignEmailBatch(campaignId, chunk)
        for (const r of results) {
          done += 1
          if (r.status === 'failed') failed.push(r.recipientId)
        }
        setEmailDone(done)
      }
      setEmailFailed(failed)
    } finally {
      setEmailRunning(false)
      router.refresh() // un solo refresh al final (la página es force-dynamic).
    }
  }

  // ── WhatsApp guiado (un toque por clienta) ───────────────────────────────
  const [guiding, setGuiding] = useState(false)
  const [waIndex, setWaIndex] = useState(0)
  const [waSending, setWaSending] = useState(false)
  const [waError, setWaError] = useState<string | null>(null)
  const current = whatsapp[waIndex]

  function openNext() {
    if (!current) return
    // Abrimos la ventana YA (gesto del usuario) para no toparnos con el bloqueador
    // de pop-ups tras el await (patrón review-link-button).
    const win = window.open('', '_blank')
    setWaSending(true)
    setWaError(null)
    ;(async () => {
      try {
        const { waUrl } = await sendCampaignMessage(current.id)
        if (waUrl) {
          if (win) win.location.href = waUrl
          else window.open(waUrl, '_blank')
        } else {
          win?.close()
          setWaError('La clienta no tiene un teléfono válido.')
        }
      } catch (e) {
        win?.close()
        setWaError(e instanceof Error ? e.message : 'No se pudo enviar')
      } finally {
        setWaSending(false)
        setWaIndex((i) => i + 1) // avanza aunque falle (optimista, un toque por clienta)
      }
    })()
  }

  function finishGuiding() {
    setGuiding(false)
    setWaIndex(0)
    router.refresh()
  }

  if (email.length === 0 && whatsapp.length === 0) return null

  return (
    <div className="studio-card space-y-4 p-4">
      {email.length > 0 && (
        <div className="flex flex-col gap-2">
          <Button onClick={runEmailBulk} disabled={emailRunning} variant="outline" className="w-fit">
            {emailRunning ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Mail className="mr-2 size-4" />}
            Enviar todos los emails ({email.length})
          </Button>
          {(emailRunning || emailDone > 0) && (
            <p className="text-sm text-muted-foreground">
              Enviando emails… {emailDone} / {email.length}
              {emailFailed.length > 0 && ` · ${emailFailed.length} con error`}
            </p>
          )}
        </div>
      )}

      {whatsapp.length > 0 && !guiding && (
        <Button
          onClick={() => {
            setGuiding(true)
            setWaIndex(0)
          }}
          className="w-fit bg-[#25D366] text-white hover:bg-[#1ebe5b]"
        >
          <MessageCircle className="mr-2 size-4" />
          WhatsApp guiado ({whatsapp.length})
        </Button>
      )}

      {guiding && (
        <div className="rounded-md border p-4">
          {current ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                {waIndex + 1} / {whatsapp.length}
              </p>
              <p className="font-semibold text-primary">{current.name}</p>
              <div className="flex gap-2">
                <Button onClick={openNext} disabled={waSending} className="bg-[#25D366] text-white hover:bg-[#1ebe5b]">
                  {waSending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <MessageCircle className="mr-2 size-4" />}
                  Abrir WhatsApp y siguiente
                </Button>
                <Button variant="ghost" onClick={finishGuiding}>
                  Terminar
                </Button>
              </div>
              {waError && <span className="text-xs text-destructive">{waError}</span>}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-primary">Listas las {whatsapp.length} de WhatsApp ✓</p>
              <Button variant="outline" onClick={finishGuiding} className="w-fit">
                Cerrar
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
