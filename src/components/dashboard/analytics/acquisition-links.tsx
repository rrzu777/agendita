'use client'

import { useCallback, useState, useTransition } from 'react'
import { Archive, Check, Copy, Link2, Pencil, Plus } from 'lucide-react'
import { archiveAcquisitionLink, createAcquisitionLink, renameAcquisitionLink } from '@/server/actions/analytics'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { OwnerAnalyticsReport } from '@/server/analytics/reports'
import Link from 'next/link'
import { Button as LinkButton } from '@/components/ui/button'
import type { AnalyticsPagination } from './analytics-tables'
import { AnalyticsOptionPicker } from './analytics-option-picker'
import type { AnalyticsOptionPage } from '@/server/analytics/options'

const channels = [
  ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['whatsapp', 'WhatsApp'], ['google', 'Google'], ['referral', 'Referido'], ['direct', 'Directo'], ['other', 'Otro'],
] as const

export function acquisitionActionMessage(result: { ok: boolean; error?: string; data?: { url: string } }) {
  return result.ok ? `Enlace creado: ${result.data?.url ?? ''}` : result.error ?? 'No se pudo crear el enlace.'
}

export function AcquisitionLinks({ links, pagination = { label: `Página ${links.page}`, previousHref: null, nextHref: null } }: { links: OwnerAnalyticsReport['acquisitionLinks']; pagination?: AnalyticsPagination }) {
  const [channel, setChannel] = useState<(typeof channels)[number][0]>('instagram')
  const [campaignName, setCampaignName] = useState('')
  const [promotionId, setPromotionId] = useState('')
  const [promotionLabels, setPromotionLabels] = useState<Record<string, string>>({})
  const receiveOptions = useCallback((options: AnalyticsOptionPage) => {
    const associated = new Set(links.rows.map(link => link.promotionId))
    setPromotionLabels(previous => Object.fromEntries([...Object.entries(previous), ...options.rows.map(option => [option.id, option.label])].filter(([id]) => associated.has(id))))
  }, [links.rows])
  const [message, setMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function rename() {
    if (!editing || pending) return
    setMessage(null); setEditError(null)
    startTransition(async () => {
      try {
        const result = await renameAcquisitionLink({ id: editing.id, campaignName: editing.label })
        if (!result.ok) { setEditError(result.error); return }
        // revalidatePath returns fresh row labels with the action's RSC response.
        // Do not retain an override that could hide a later server-side rename.
        setEditing(null); setMessage('Etiqueta actualizada.')
      } catch { setEditError('No se pudo guardar la etiqueta. Intenta nuevamente.') }
    })
  }

  function create() {
    startTransition(async () => {
      const result = await createAcquisitionLink({ channel, campaignName, ...(promotionId ? { promotionId } : {}) })
      if (!result.ok) return setMessage(acquisitionActionMessage(result))
      setCampaignName('')
      setPromotionId('')
      setMessage(acquisitionActionMessage(result))
    })
  }

  function archive(id: string) {
    startTransition(async () => {
      const result = await archiveAcquisitionLink(id)
      setMessage(result.ok ? 'Enlace archivado. Actualiza la página para ver el registro vigente.' : result.error)
    })
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setMessage('Enlace copiado.')
    } catch {
      setMessage('No se pudo copiar el enlace. Selecciónalo y cópialo manualmente.')
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="acquisition-links-title">
      <div><h2 id="acquisition-links-title" className="font-heading text-2xl font-semibold tracking-tight text-primary">Enlaces de adquisición</h2><p className="text-sm text-muted-foreground">Registro gestionable separado de los totales por origen. Los enlaces nuevos se conservan aunque aún no tengan tráfico.</p></div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="size-4" />Crear enlace</CardTitle><CardDescription>La etiqueta no debe incluir datos de contacto ni URLs.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 sm:items-start">
          <div className="grid gap-2"><Label htmlFor="analytics-channel">Canal</Label><Select value={channel} onValueChange={(value) => setChannel(value as typeof channel)}><SelectTrigger id="analytics-channel" aria-label="Canal del enlace"><SelectValue /></SelectTrigger><SelectContent>{channels.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-2"><Label htmlFor="analytics-campaign">Etiqueta de campaña</Label><Input id="analytics-campaign" value={campaignName} maxLength={80} onChange={(event) => setCampaignName(event.target.value)} placeholder="Ej. Lanzamiento septiembre" /></div>
          <div><AnalyticsOptionPicker kind="promotion" label="Promoción opcional" value={promotionId} onChange={setPromotionId} onOptions={receiveOptions} /><p className="mt-2 text-xs text-muted-foreground">Asociación inmutable de llegada. No aplica un cupón automáticamente ni cambia el precio.</p></div>
          <Button type="button" onClick={create} disabled={pending || campaignName.trim().length === 0}><Link2 data-icon="inline-start" />Crear enlace</Button>
        </CardContent>
      </Card>
      {message && <p role="status" className="rounded-lg bg-secondary/50 px-3 py-2 text-sm text-primary">{message}</p>}
      <div tabIndex={0} aria-label="Desplazar enlaces de adquisición horizontalmente" className="overflow-x-auto rounded-xl ring-1 ring-border/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <table aria-label="Enlaces de adquisición" className="w-full min-w-[44rem] caption-bottom text-sm">
          <thead><tr className="border-b bg-secondary/35"><th className="h-10 px-2 text-left text-sm font-medium">Etiqueta actual</th><th className="h-10 px-2 text-left text-sm font-medium">Canal</th><th className="h-10 px-2 text-left text-sm font-medium">Enlace</th><th className="h-10 px-2 text-left text-sm font-medium">Estado</th><th aria-label="Acciones" className="h-10 px-2 text-left text-sm font-medium" /></tr></thead>
          <tbody>{links.rows.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No hay enlaces creados todavía.</td></tr> : links.rows.map((link) => (
            <tr key={link.id} className="border-b hover:bg-muted/50">
              <td className="p-2 font-medium text-primary">
                {editing?.id === link.id ? <form aria-label="Editar etiqueta actual" aria-busy={pending} className="min-w-48 space-y-2" onSubmit={event => { event.preventDefault(); rename() }}>
                  <Label htmlFor={`analytics-label-${link.id}`}>Etiqueta actual del enlace</Label>
                  <Input id={`analytics-label-${link.id}`} aria-label="Etiqueta actual del enlace" value={editing.label} maxLength={80} required disabled={pending} onChange={event => setEditing({ id: link.id, label: event.target.value })} />
                  <p className="text-xs font-normal text-muted-foreground">Sólo cambia el nombre visible actual, no el origen ni su historia.</p>
                  {editError && <p role="alert" className="text-sm text-destructive">{editError}</p>}
                  <div className="flex gap-2"><Button type="submit" size="sm" aria-label="Guardar etiqueta" disabled={pending || !editing.label.trim()}>{pending ? 'Guardando…' : 'Guardar etiqueta'}</Button><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(null); setEditError(null) }}>Cancelar edición</Button></div>
                </form> : link.campaignName}
                <span className="block text-xs font-normal text-muted-foreground">{link.promotionId ? `Promoción asociada: ${promotionLabels[link.promotionId] ?? `nombre no disponible · ${link.promotionId}`}` : 'Sin promoción asociada'}</span>
              </td>
              <td className="p-2">{channels.find(([value]) => value === link.channel)?.[1] ?? link.channel}</td>
              <td className="max-w-[18rem] truncate p-2 font-mono text-xs" title={link.url}>{link.url}</td>
              <td className="p-2">{link.archivedAt ? 'Archivado' : 'Activo'}</td>
              <td className="space-x-1 p-2 text-right">
                <Button type="button" size="icon-sm" variant="outline" aria-label={`Editar etiqueta de ${link.campaignName}`} disabled={pending} onClick={() => { setEditing({ id: link.id, label: link.campaignName }); setEditError(null); setMessage(null) }}><Pencil /></Button>
                <Button type="button" size="icon-sm" variant="outline" aria-label={`Copiar ${link.campaignName}`} onClick={() => void copy(link.url)}><Copy /></Button>
                {!link.archivedAt && <Button type="button" size="icon-sm" variant="outline" aria-label={`Archivar ${link.campaignName}`} disabled={pending} onClick={() => archive(link.id)}><Archive /></Button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{pagination.label} · {links.total} enlace{links.total === 1 ? '' : 's'} en el registro. {pending && <span className="inline-flex items-center gap-1"><Check className="size-3" />Procesando…</span>}</span>{pagination.previousHref && <LinkButton asChild size="sm" variant="outline"><Link href={pagination.previousHref}>Anterior</Link></LinkButton>}{pagination.nextHref && <LinkButton asChild size="sm" variant="outline"><Link href={pagination.nextHref}>Siguiente enlaces</Link></LinkButton>}</div>
    </section>
  )
}
