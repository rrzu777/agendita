'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { SetupChecklist as SetupChecklistData } from '@/lib/dashboard/setup-checklist'
import { CheckCircle2, Circle, Copy, ExternalLink, MessageCircle } from 'lucide-react'

const ITEM_CLASS =
  'flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm transition hover:border-primary/40'

export function SetupChecklist({
  checklist,
  initialSetupIncomplete = false,
}: {
  checklist: SetupChecklistData
  initialSetupIncomplete?: boolean
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const [copyError, setCopyError] = useState('')
  const content = (
    <div className="space-y-3">
      {checklist.items.map((item) => {
        const Icon = item.completed ? CheckCircle2 : Circle
        // Casi todos los items apuntan adentro del dashboard; el del link público es
        // una URL absoluta al sitio del negocio. Los internos van por <Link> o cada
        // paso del checklist recarga la app entera.
        const isExternal = item.href.startsWith('http')
        const body = (
          <>
            <span className="flex min-w-0 items-center gap-3">
              <Icon className={item.completed ? 'size-5 shrink-0 text-success' : 'size-5 shrink-0 text-muted-foreground'} />
              <span className="font-medium text-foreground">{item.label}</span>
            </span>
            <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
          </>
        )
        return isExternal ? (
          <a key={item.key} href={item.href} target="_blank" rel="noopener noreferrer" className={ITEM_CLASS}>
            {body}
          </a>
        ) : (
          <Link key={item.key} href={item.href} className={ITEM_CLASS}>
            {body}
          </Link>
        )
      })}
    </div>
  )

  async function copyLink(label: string, url: string) {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(url)
      setCopied(label)
      setTimeout(() => setCopied(null), 2500)
    } catch {
      setCopied(null)
      setCopyError('No pudimos copiar el enlace. Intenta de nuevo.')
    }
  }

  const whatsappText = encodeURIComponent(`Reserva aquí: ${checklist.bookingUrl}`)

  return (
    <section data-tour-id="dashboard-checklist" className="studio-card shadow-none mb-8 border-border/60 bg-card p-5 md:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Configuración del negocio</p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">
            {checklist.isReady ? 'Negocio listo para operar' : `${checklist.completedCount}/${checklist.totalCount} listo`}
          </h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {initialSetupIncomplete && (
            <Button variant="outline" className="min-h-11 min-w-11" asChild>
              <Link href="/dashboard/onboarding">Continuar configuración inicial</Link>
            </Button>
          )}
          <Button type="button" variant="outline" className="min-h-11 min-w-11" onClick={() => copyLink('perfil', checklist.publicUrl)}>
            <Copy className="mr-2 size-4" />
            {copied === 'perfil' ? 'Perfil copiado' : 'Copiar perfil'}
          </Button>
          <Button type="button" variant="outline" className="min-h-11 min-w-11" onClick={() => copyLink('reserva', checklist.bookingUrl)}>
            <Copy className="mr-2 size-4" />
            {copied === 'reserva' ? 'Reserva copiada' : 'Copiar reserva'}
          </Button>
          <Button type="button" className="min-h-11 min-w-11 w-full sm:w-auto" asChild><a href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-2 size-4" />
              WhatsApp
            </a></Button>
        </div>
      </div>

      {copyError && (
        <p role="alert" className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {copyError}
        </p>
      )}

      {checklist.isReady ? (
        <details className="rounded-xl border border-success/20 bg-success/5 p-4 text-sm text-success">
          <summary className="cursor-pointer font-semibold">Todo configurado. Ver checklist</summary>
          <div className="mt-4">{content}</div>
        </details>
      ) : content}
    </section>
  )
}
