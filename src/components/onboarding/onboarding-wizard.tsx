'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Building2,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Scissors,
  Shield,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DashboardPageHeader } from '@/components/dashboard/dashboard-page-header'
import { completeOnboarding, saveOnboardingStep } from '@/server/actions/onboarding'

interface OnboardingPageProps {
  business: {
    id: string
    name: string
    subdomain: string
    slug: string
    bio: string | null
    addressText: string | null
    whatsapp: string | null
    instagram: string | null
    city: string
    depositPolicy: string | null
    cancellationPolicy: string | null
    bookingPolicy: string | null
    onboardingStep: number | null
  }
  servicesCount: number
  availabilityCount: number
  publicUrl: string
  bookingUrl: string
}

const steps = [
  { key: 'profile', label: 'Tu negocio', icon: Building2 },
  { key: 'services', label: 'Servicios', icon: Scissors },
  { key: 'schedule', label: 'Horarios', icon: Clock },
  { key: 'policies', label: 'Políticas', icon: Shield },
  { key: 'ready', label: 'Listo para recibir reservas', icon: Globe },
] as const

function validStep(step: number | null): number {
  return Number.isInteger(step) && step !== null && step >= 0 && step < steps.length ? step : 0
}

export function OnboardingWizard({
  business,
  servicesCount,
  availabilityCount,
  publicUrl,
  bookingUrl,
}: OnboardingPageProps) {
  const router = useRouter()
  const initialStep = validStep(business.onboardingStep)
  const [currentKey, setCurrentKey] = useState<(typeof steps)[number]['key']>(steps[initialStep].key)
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const finishInFlight = useRef(false)
  const latestSave = useRef(0)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())

  const profileReady = Boolean(business.name.trim() && business.city.trim() && (business.subdomain || business.slug))
  const policiesReady = Boolean(
    business.depositPolicy?.trim()
    || business.cancellationPolicy?.trim()
    || business.bookingPolicy?.trim(),
  )
  const canFinish = servicesCount > 0 && availabilityCount > 0
  const readiness = [profileReady, servicesCount > 0, availabilityCount > 0, policiesReady, canFinish]

  function persistStep(step: number) {
    const request = ++latestSave.current
    setSaveError('')
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const result = await saveOnboardingStep(business.id, step)
          if (!result.ok && request === latestSave.current) {
            setSaveError(result.error)
          }
        } catch {
          if (request === latestSave.current) {
            setSaveError('No pudimos guardar esta sección. Intenta de nuevo.')
          }
        }
      })
  }

  function handleTabChange(value: string) {
    const step = steps.findIndex((candidate) => candidate.key === value)
    if (step < 0) return
    setCurrentKey(steps[step].key)
    persistStep(step)
  }

  async function handleFinish() {
    if (finishInFlight.current || !canFinish) return
    finishInFlight.current = true
    setFinishing(true)
    setFinishError('')
    try {
      // Finishing clears onboardingStep. Waiting here prevents a tab save that was
      // already in flight from writing an older step after that terminal update.
      await saveQueue.current
      const result = await completeOnboarding(business.id)
      if (!result.ok) {
        setFinishError(result.error)
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setFinishError('Error al finalizar. Intenta de nuevo.')
    } finally {
      finishInFlight.current = false
      setFinishing(false)
    }
  }

  async function handleCopy() {
    setCopied(false)
    setCopyError('')
    try {
      await navigator.clipboard.writeText(bookingUrl)
      setCopied(true)
    } catch {
      setCopyError('No pudimos copiar el enlace. Intenta de nuevo.')
    }
  }

  return (
    <div>
      <DashboardPageHeader
        title="Configura tu negocio"
        subtitle="Revisa cada sección cuando te acomode. Puedes volver a Hoy sin finalizar."
        action={<Button asChild variant="outline" className="min-h-11 min-w-11"><Link href="/dashboard">Volver a Hoy</Link></Button>}
      />
      <div className="mx-auto max-w-3xl p-4 min-[1100px]:p-10">
        <Tabs value={currentKey} onValueChange={handleTabChange}>
          <TabsList aria-label="Configuración inicial">
            {steps.map((step, index) => {
              const Icon = step.icon
              const ready = readiness[index]
              return (
                <TabsTrigger
                  key={step.key}
                  value={step.key}
                  data-ready={String(ready)}
                  disabled={finishing}
                  onClick={() => {
                    // Radix activates tabs on pointer down. The click fallback keeps
                    // programmatic activation equivalent in our DOM harness.
                    if (currentKey !== step.key) handleTabChange(step.key)
                  }}
                >
                  {ready
                    ? <CheckCircle2 aria-hidden="true" className="size-4" />
                    : <Icon aria-hidden="true" className="size-4" />}
                  {step.label}
                  <span className="sr-only">{ready ? 'Listo' : 'Pendiente'}</span>
                </TabsTrigger>
              )
            })}
          </TabsList>

          {saveError && (
            <div role="alert" className="flex flex-col gap-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
              <span>{saveError}</span>
              <Button type="button" variant="outline" className="min-h-11 min-w-11" onClick={() => persistStep(steps.findIndex((step) => step.key === currentKey))}>
                Reintentar guardado
              </Button>
            </div>
          )}

          <div className="min-h-[300px] rounded-xl border border-border bg-card p-4 md:p-6">
            {currentKey === 'profile' && <TabsContent value="profile"><StepProfile business={business} publicUrl={publicUrl} /></TabsContent>}
            {currentKey === 'services' && <TabsContent value="services"><StepServices servicesCount={servicesCount} /></TabsContent>}
            {currentKey === 'schedule' && <TabsContent value="schedule"><StepSchedule availabilityCount={availabilityCount} /></TabsContent>}
            {currentKey === 'policies' && <TabsContent value="policies"><StepPolicies /></TabsContent>}
            {currentKey === 'ready' && <TabsContent value="ready">
              <StepReady
                publicUrl={publicUrl}
                bookingUrl={bookingUrl}
                canFinish={canFinish}
                copied={copied}
                copyError={copyError}
                finishError={finishError}
                finishing={finishing}
                onCopy={handleCopy}
                onFinish={handleFinish}
              />
            </TabsContent>}
          </div>
        </Tabs>
      </div>
    </div>
  )
}

function StepProfile({ business, publicUrl }: { business: OnboardingPageProps['business']; publicUrl: string }) {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-primary">Datos de tu negocio</h2>
      <p className="text-muted-foreground">Revisa tu información principal y edítala en Configuración cuando lo necesites.</p>
      <div className="grid gap-4 rounded-lg bg-muted/30 p-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nombre</p>
          <p className="mt-1 font-semibold text-primary">{business.name}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Perfil público</p>
          <p className="mt-1 break-all font-mono text-sm text-primary">{publicUrl}</p>
        </div>
        {business.city && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ciudad</p>
            <p className="mt-1 text-primary">{business.city}</p>
          </div>
        )}
      </div>
      <Button variant="outline" className="min-h-11 min-w-11" asChild><Link href="/dashboard/settings/profile">Editar perfil</Link></Button>
    </div>
  )
}

function StepServices({ servicesCount }: { servicesCount: number }) {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-primary">Tus servicios</h2>
      <p className="text-muted-foreground">Los clientes elegirán entre tus servicios activos al reservar.</p>
      <div className="rounded-lg bg-muted/30 p-5 text-center">
        <p className="text-4xl font-semibold text-primary">{servicesCount}</p>
        <p className="mt-1 text-sm text-muted-foreground">servicios activos</p>
      </div>
      <div className={servicesCount > 0 ? 'rounded-lg border border-success/20 bg-success/5 p-4 text-sm text-success' : 'rounded-lg border border-warning/20 bg-warning/10 p-4 text-sm text-warning'}>
        <p className="font-semibold">{servicesCount > 0 ? 'Servicios listos' : 'Agrega al menos un servicio activo'}</p>
        <Button variant="outline" className="mt-3 min-h-11 min-w-11" asChild><Link href="/dashboard/services">Ver servicios</Link></Button>
      </div>
    </div>
  )
}

function StepSchedule({ availabilityCount }: { availabilityCount: number }) {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-primary">Tus horarios</h2>
      <p className="text-muted-foreground">Define cuándo aceptas reservas. Los clientes solo podrán agendar en esos horarios.</p>
      <div className="rounded-lg bg-muted/30 p-5 text-center">
        <p className="text-4xl font-semibold text-primary">{availabilityCount}</p>
        <p className="mt-1 text-sm text-muted-foreground">días activos para el negocio</p>
      </div>
      <div className={availabilityCount > 0 ? 'rounded-lg border border-success/20 bg-success/5 p-4 text-sm text-success' : 'rounded-lg border border-warning/20 bg-warning/10 p-4 text-sm text-warning'}>
        <p className="font-semibold">{availabilityCount > 0 ? 'Horarios listos' : 'Configura al menos un día de atención'}</p>
        <Button variant="outline" className="mt-3 min-h-11 min-w-11" asChild><Link href="/dashboard/availability">Ver disponibilidad</Link></Button>
      </div>
    </div>
  )
}

function StepPolicies() {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-primary">Políticas de reserva</h2>
      <p className="text-muted-foreground">Define las reglas sobre abonos, cancelaciones y avisos para tus clientes.</p>
      <div className="space-y-3 rounded-lg bg-muted/30 p-5 text-sm text-muted-foreground">
        <p><strong className="text-foreground">Abono:</strong> se configura por servicio.</p>
        <p><strong className="text-foreground">Cancelación:</strong> explica con claridad tus plazos y condiciones.</p>
      </div>
      <Button variant="outline" className="min-h-11 min-w-11" asChild><Link href="/dashboard/settings/policies">Editar políticas</Link></Button>
    </div>
  )
}

function StepReady({
  publicUrl,
  bookingUrl,
  canFinish,
  copied,
  copyError,
  finishError,
  finishing,
  onCopy,
  onFinish,
}: {
  publicUrl: string
  bookingUrl: string
  canFinish: boolean
  copied: boolean
  copyError: string
  finishError: string
  finishing: boolean
  onCopy: () => Promise<void>
  onFinish: () => Promise<void>
}) {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-success/10">
        <CheckCircle2 aria-hidden="true" className="size-8 text-success" />
      </div>
      <div>
        <h2 className="text-2xl font-semibold text-primary">{canFinish ? 'Listo para recibir reservas' : 'Aún falta configuración'}</h2>
        <p className="mt-2 text-muted-foreground">
          {canFinish
            ? 'Tus servicios y horarios permiten finalizar la configuración inicial.'
            : 'Necesitas al menos un servicio activo y un día de atención del negocio.'}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 break-all rounded border border-border bg-card px-3 py-2 text-left font-mono text-sm text-primary">{bookingUrl}</code>
          <Button type="button" variant="outline" onClick={onCopy} className="min-h-11 min-w-11 shrink-0">
            <Copy aria-hidden="true" className="size-4" />
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
        {copyError && <p role="alert" className="mt-3 text-left text-sm text-destructive">{copyError}</p>}
        {copied && <p role="status" className="mt-3 text-left text-sm text-success">Enlace copiado.</p>}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Button variant="outline" className="min-h-11 min-w-11" asChild><a href={publicUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" className="size-4" />Ver perfil público</a></Button>
        <Button variant="outline" className="min-h-11 min-w-11" asChild><a href={bookingUrl} target="_blank" rel="noopener noreferrer"><CalendarCheck2 aria-hidden="true" className="size-4" />Abrir reservas</a></Button>
      </div>

      {finishError && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-left text-sm text-destructive">{finishError}</p>}
      <Button type="button" onClick={onFinish} disabled={!canFinish || finishing} className="min-h-11 min-w-11">
        {finishing ? 'Finalizando…' : 'Finalizar configuración'}
      </Button>
      {!canFinish && <p className="text-sm text-muted-foreground">Finalizar se habilita cuando servicios y horarios estén listos.</p>}
    </div>
  )
}
