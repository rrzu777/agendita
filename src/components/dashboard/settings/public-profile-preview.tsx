'use client'

import { useState } from 'react'
import { ExternalLink, Globe } from 'lucide-react'

type PublicProfilePreviewProps = {
  name: string
  city: string
  bio: string
  logoUrl: string
  publicUrl: string
}

export function PublicProfilePreview({
  name,
  city,
  bio,
  logoUrl,
  publicUrl,
}: PublicProfilePreviewProps) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null)
  const showLogo = Boolean(logoUrl) && failedLogoUrl !== logoUrl
  const initials = name.trim().slice(0, 2).toUpperCase() || '•'

  return (
    <aside aria-label="Vista previa del perfil público" className="xl:sticky xl:top-8 xl:self-start">
      <div className="space-y-4 rounded-xl border border-border/70 bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Globe className="size-4" aria-hidden="true" />
          Vista previa pública
        </div>

        <div className="flex items-start gap-3">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-lg font-semibold text-muted-foreground">
            {showLogo ? (
              // External image hosts are business-configurable and therefore cannot use next/image here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={`Logo de ${name || 'tu negocio'}`}
                width={64}
                height={64}
                className="size-full object-contain"
                onError={() => setFailedLogoUrl(logoUrl)}
              />
            ) : initials}
          </div>
          <div className="min-w-0 space-y-1">
            <h2 className="break-words font-heading text-lg font-semibold text-primary">{name || 'Tu negocio'}</h2>
            {city && <p className="break-words text-sm text-muted-foreground">{city}</p>}
          </div>
        </div>

        {bio ? <p className="break-words whitespace-pre-wrap text-sm text-muted-foreground">{bio}</p> : null}

        <div className="space-y-1 border-t border-border/60 pt-4">
          <p className="text-xs font-medium text-muted-foreground">URL pública</p>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 break-all text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {publicUrl}
            <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
          </a>
        </div>
      </div>
    </aside>
  )
}
