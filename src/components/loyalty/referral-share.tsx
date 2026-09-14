'use client'

import { useState } from 'react'
import type { Vocabulary } from '@/lib/vocabulary'

export function ReferralShare({
  url,
  firstName,
  vocabulary,
  titleAs: TitleTag = 'h2',
}: {
  url: string
  firstName: string
  vocabulary: Vocabulary
  titleAs?: 'h2' | 'h3'
}) {
  const [copied, setCopied] = useState(false)

  const message = `${firstName} te invita a reservar. Usa este enlace y ${vocabulary.bothWin}: ${url}`
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(message)}`

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Si clipboard no está disponible, el link sigue visible para copiar a mano.
    }
  }

  return (
    <section className="mt-8">
      <TitleTag className="mb-2 text-sm font-semibold text-primary">{vocabulary.referAFriend}</TitleTag>
      <div className="rounded-[var(--radius)] bg-[var(--tenant-brand-soft)] p-4">
        <p className="text-sm text-[var(--tenant-brand-strong)]">Comparte tu enlace y {vocabulary.bothWin} recompensas.</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-card px-3 py-2">
          <code className="flex-1 truncate font-mono text-xs text-muted-foreground">{url}</code>
          <button
            type="button"
            onClick={handleCopy}
            className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-xs font-semibold text-primary"
          >
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex min-h-11 items-center justify-center rounded-lg bg-primary px-3 text-center text-sm font-semibold text-primary-foreground"
        >
          Compartir por WhatsApp
        </a>
      </div>
    </section>
  )
}
