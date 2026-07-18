'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Mail, MessageCircle, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TruncatedCell } from '@/components/ui/truncated-cell'
import { TableMobileCard } from '@/components/ui/table-mobile-card'
import { TABLE_COL, TABLE_MIN_WIDTH } from '@/components/ui/table-widths'
import { StatusBadge } from '@/components/ui/status-badge'
import { sendCampaignMessage, sendCampaignEmail } from '@/server/actions/campaigns'
import { BulkSendControls } from './bulk-send-controls'

export interface RecipientItem {
  id: string
  name: string
  phone: string
  email: string | null
  sentAt: Date | null
  grantStatus: string | null
  optedOut: boolean
  channel: 'whatsapp' | 'email' | 'none'
}

export interface RecipientMetrics {
  enviadas: number
  canjearon: number
  vigentes: number
}

function recipientStatus(r: RecipientItem): 'redeemed' | 'sent' | 'pending' {
  if (r.grantStatus === 'redeemed') return 'redeemed'
  if (r.sentAt) return 'sent'
  return 'pending'
}

export function RecipientList({
  campaignId,
  recipients,
  metrics,
}: {
  campaignId: string
  recipients: RecipientItem[]
  metrics: RecipientMetrics
}) {
  const router = useRouter()
  // Derivado de recipients (igual que "Destinatarias"): no viaja como métrica.
  const noContactar = recipients.filter((r) => r.optedOut).length
  const [sending, setSending] = useState<Set<string>>(new Set())
  const [error, setError] = useState<{ recipientId: string; message: string } | null>(null)

  // Prende/apaga el spinner de la fila alrededor de `fn`; el manejo de error vive
  // dentro de cada handler (WhatsApp cierra su popup; email sólo setea el mensaje).
  async function withSending(recipientId: string, fn: () => Promise<void>) {
    setSending((prev) => new Set(prev).add(recipientId))
    setError(null)
    try {
      await fn()
    } finally {
      setSending((prev) => {
        const next = new Set(prev)
        next.delete(recipientId)
        return next
      })
    }
  }

  function handleSend(recipientId: string) {
    // Abrimos la ventana de inmediato (gesto del usuario) y luego fijamos la URL,
    // para no toparnos con el bloqueador de pop-ups tras el await (patrón review-link-button).
    const win = window.open('', '_blank')
    return withSending(recipientId, async () => {
      try {
        const { waUrl } = await sendCampaignMessage(recipientId)
        if (waUrl) {
          if (win) win.location.href = waUrl
          else window.open(waUrl, '_blank')
        } else {
          win?.close()
          setError({ recipientId, message: 'La clienta no tiene un teléfono válido.' })
        }
        router.refresh()
      } catch (e) {
        win?.close()
        setError({ recipientId, message: e instanceof Error ? e.message : 'No se pudo enviar' })
      }
    })
  }

  function handleSendEmail(recipientId: string) {
    return withSending(recipientId, async () => {
      try {
        const { sent, error: err } = await sendCampaignEmail(recipientId)
        if (!sent) setError({ recipientId, message: err ?? 'No se pudo enviar el email' })
        router.refresh()
      } catch (e) {
        setError({ recipientId, message: e instanceof Error ? e.message : 'No se pudo enviar' })
      }
    })
  }

  function sendButton(r: RecipientItem) {
    if (r.optedOut || r.channel === 'none') {
      return <span className="text-sm text-muted-foreground">No contactar</span>
    }
    const cfg = r.channel === 'email'
      ? {
          onClick: () => handleSendEmail(r.id),
          Icon: Mail,
          buttonProps: { variant: 'outline' as const },
          label: r.sentAt ? 'Reenviar email' : 'Enviar email',
        }
      : {
          onClick: () => handleSend(r.id),
          Icon: MessageCircle,
          buttonProps: { className: 'bg-[#25D366] text-white hover:bg-[#1ebe5b]' },
          label: r.sentAt ? 'Reenviar' : 'Enviar por WhatsApp',
        }
    const { Icon } = cfg
    return (
      <div className="flex flex-col items-end gap-1">
        <Button size="sm" {...cfg.buttonProps} onClick={cfg.onClick} disabled={sending.has(r.id)}>
          {sending.has(r.id) ? (
            <Loader2 className="mr-1 size-4 animate-spin" />
          ) : (
            <Icon className="mr-1 size-4" />
          )}
          {cfg.label}
        </Button>
        {error?.recipientId === r.id && (
          <span className="text-xs text-destructive">{error.message}</span>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Métricas (patrón stat-cards de customers/[id]) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="studio-card p-4">
          <p className="studio-eyebrow">Destinatarias</p>
          <p className="mt-1 text-2xl font-semibold text-primary">{recipients.length}</p>
        </div>
        <div className="studio-card p-4">
          <p className="studio-eyebrow">Enviadas</p>
          <p className="mt-1 text-2xl font-semibold text-primary">{metrics.enviadas}</p>
        </div>
        <div className="studio-card p-4">
          <p className="studio-eyebrow">Canjearon</p>
          <p className="mt-1 text-2xl font-semibold text-green-700">{metrics.canjearon}</p>
        </div>
        <div className="studio-card p-4">
          <p className="studio-eyebrow">Vigentes</p>
          <p className="mt-1 text-2xl font-semibold text-primary">{metrics.vigentes}</p>
        </div>
        <div className="studio-card p-4">
          <p className="studio-eyebrow">No contactar</p>
          <p className="mt-1 text-2xl font-semibold text-muted-foreground">{noContactar}</p>
        </div>
      </div>

      {recipients.length > 0 && <BulkSendControls campaignId={campaignId} recipients={recipients} />}

      {recipients.length === 0 ? (
        <div className="studio-card overflow-hidden py-12 text-center">
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-14 items-center justify-center rounded-full bg-muted">
              <Users className="size-7 text-muted-foreground" />
            </div>
            <div>
              <p className="mb-1 font-heading text-base font-semibold text-primary">Sin destinatarias</p>
              <p className="text-sm text-muted-foreground">
                Ninguna clienta coincidió con el segmento de esta campaña.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Desktop: tabla */}
          <div className="hidden lg:block studio-card overflow-hidden">
            <Table fixed className={TABLE_MIN_WIDTH}>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Nombre</TableHead>
                  <TableHead className={TABLE_COL.contact}>Teléfono</TableHead>
                  <TableHead className={TABLE_COL.status}>Estado</TableHead>
                  <TableHead className="w-[210px]">
                    <span className="sr-only">Enviar</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.map((r) => (
                  <TableRow key={r.id}>
                    <TruncatedCell className="font-semibold text-primary" primary={r.name} />
                    <TableCell className={`${TABLE_COL.contact} whitespace-nowrap text-sm`}>{r.phone}</TableCell>
                    <TableCell className={`${TABLE_COL.status} text-sm`}>
                      <StatusBadge status={recipientStatus(r)} map="campaignRecipient" />
                    </TableCell>
                    <TableCell className="w-[210px] text-right">{sendButton(r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
          <div className="space-y-3 lg:hidden">
            {recipients.map((r) => (
              <TableMobileCard
                key={r.id}
                title={r.name}
                subtitle={r.phone}
                rows={[{ label: 'Estado', value: <StatusBadge status={recipientStatus(r)} map="campaignRecipient" /> }]}
                actions={sendButton(r)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
