'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { SetupChecklist as SetupChecklistData } from '@/lib/dashboard/setup-checklist'
import { CheckCircle2, Circle, Copy, ExternalLink, MessageCircle } from 'lucide-react'

export function SetupChecklist({ checklist }: { checklist: SetupChecklistData }) {
  const [copied, setCopied] = useState<string | null>(null)
  const content = (
    <div className="space-y-3">
      {checklist.items.map((item) => {
        const Icon = item.completed ? CheckCircle2 : Circle
        return (
          <a
            key={item.key}
            href={item.href}
            target={item.href.startsWith('http') ? '_blank' : undefined}
            rel={item.href.startsWith('http') ? 'noopener noreferrer' : undefined}
            className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-sm transition hover:border-primary/40"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Icon className={item.completed ? 'size-5 shrink-0 text-green-600' : 'size-5 shrink-0 text-muted-foreground'} />
              <span className="font-medium text-primary">{item.label}</span>
            </span>
            <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
          </a>
        )
      })}
    </div>
  )

  async function copyLink(label: string, url: string) {
    await navigator.clipboard.writeText(url)
    setCopied(label)
    setTimeout(() => setCopied(null), 2500)
  }

  const whatsappText = encodeURIComponent(`Reserva aquí: ${checklist.bookingUrl}`)

  return (
    <section className="studio-card mb-8 border-border/60 bg-card p-5 md:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Checklist de adopción</p>
          <h2 className="mt-1 text-2xl font-semibold text-primary">
            {checklist.isReady ? 'Negocio listo para operar' : `${checklist.completedCount}/${checklist.totalCount} listo`}
          </h2>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => copyLink('perfil', checklist.publicUrl)}>
            <Copy className="mr-2 size-4" />
            {copied === 'perfil' ? 'Perfil copiado' : 'Copiar perfil'}
          </Button>
          <Button type="button" variant="outline" onClick={() => copyLink('reserva', checklist.bookingUrl)}>
            <Copy className="mr-2 size-4" />
            {copied === 'reserva' ? 'Reserva copiada' : 'Copiar reserva'}
          </Button>
          <a href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noopener noreferrer">
            <Button type="button" className="w-full sm:w-auto">
              <MessageCircle className="mr-2 size-4" />
              WhatsApp
            </Button>
          </a>
        </div>
      </div>

      {checklist.isReady ? (
        <details className="rounded-xl border border-green-200 bg-green-50/60 p-4 text-sm text-green-900">
          <summary className="cursor-pointer font-semibold">Todo configurado. Ver checklist</summary>
          <div className="mt-4">{content}</div>
        </details>
      ) : content}
    </section>
  )
}
