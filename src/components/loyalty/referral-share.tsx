'use client'

import { useState } from 'react'

export function ReferralShare({ url, firstName }: { url: string; firstName: string }) {
  const [copied, setCopied] = useState(false)

  const message = `${firstName} te invita a reservar. Usa este enlace y ambas ganan: ${url}`
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
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Referí a una amiga</h2>
      <div className="rounded-2xl bg-pink-50 p-4">
        <p className="text-sm text-pink-700">Comparte tu enlace y ambas ganan recompensas.</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-white px-3 py-2">
          <code className="flex-1 truncate font-mono text-xs text-gray-600">{url}</code>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 rounded-md border border-pink-200 px-2 py-1 text-xs font-medium text-pink-700"
          >
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block rounded-md bg-pink-600 px-3 py-2 text-center text-sm font-medium text-white"
        >
          Compartir por WhatsApp
        </a>
      </div>
    </section>
  )
}
