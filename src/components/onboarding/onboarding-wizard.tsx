'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { completeOnboarding, saveOnboardingStep } from '@/server/actions/onboarding'
import {
  ArrowLeft,
  ArrowRight,
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
import { cn } from '@/lib/utils'

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
  { key: 'publish', label: 'Publicar', icon: Globe },
]

export function OnboardingWizard({
  business,
  servicesCount,
  availabilityCount,
  publicUrl,
  bookingUrl,
}: OnboardingPageProps) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(business.onboardingStep ?? 0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const totalSteps = steps.length

  async function handleNext() {
    try {
      const res = await saveOnboardingStep(business.id, currentStep + 1)
      if (!res.ok) { setError(res.error); return }
      setCurrentStep((s) => Math.min(s + 1, totalSteps - 1))
      setError('')
    } catch {
      setError('Error al guardar progreso')
    }
  }

  async function handleBack() {
    const prev = Math.max(0, currentStep - 1)
    try {
      const res = await saveOnboardingStep(business.id, prev)
      // navegar igual aunque falle el guardado — comportamiento original
      if (!res.ok) { setCurrentStep(prev); return }
      setCurrentStep(prev)
      setError('')
    } catch {
      setCurrentStep(prev)
    }
  }

  async function handleFinish() {
    setLoading(true)
    setError('')
    try {
      const res = await completeOnboarding(business.id)
      if (!res.ok) { setError(res.error); return }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Error al finalizar. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:py-16">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-semibold tracking-normal text-primary md:text-5xl">
          Configura tu negocio
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Completa estos pasos para empezar a recibir reservas
        </p>
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between">
          {steps.map((step, i) => {
            const Icon = step.icon
            const isActive = i === currentStep
            const isCompleted = i < currentStep
            return (
              <div key={step.key} className="flex items-center">
                <div className={cn(
                  'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  isActive && 'bg-primary text-primary-foreground',
                  isCompleted && 'bg-green-100 text-green-800',
                  !isActive && !isCompleted && 'bg-muted text-muted-foreground'
                )}>
                  {isCompleted ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : (
                    <Icon className="size-3.5" />
                  )}
                  <span className="hidden sm:inline">{step.label}</span>
                </div>
                {i < steps.length - 1 && (
                  <div className={cn(
                    'mx-1 h-px w-4 sm:w-8',
                    i < currentStep ? 'bg-green-300' : 'bg-border'
                  )} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-6 md:p-8">
          {currentStep === 0 && <StepProfile business={business} publicUrl={publicUrl} />}
          {currentStep === 1 && <StepServices servicesCount={servicesCount} />}
          {currentStep === 2 && <StepSchedule availabilityCount={availabilityCount} />}
          {currentStep === 3 && <StepPolicies />}
          {currentStep === 4 && (
            <StepPublish
              publicUrl={publicUrl}
              bookingUrl={bookingUrl}
              canPublish={servicesCount > 0 && availabilityCount > 0}
              copied={copied}
              onCopy={() => { navigator.clipboard.writeText(bookingUrl); setCopied(true) }}
            />
          )}
        </CardContent>
      </Card>

      <div className="mt-6 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 0 || loading}
        >
          <ArrowLeft className="mr-2 size-4" />
          Anterior
        </Button>

        {currentStep < totalSteps - 1 ? (
          <Button onClick={handleNext} disabled={loading}>
            Siguiente
            <ArrowRight className="ml-2 size-4" />
          </Button>
        ) : (
          <Button onClick={handleFinish} disabled={loading || servicesCount === 0 || availabilityCount === 0} className="shadow-[0_14px_32px_rgba(51,41,32,0.18)]">
            {loading ? 'Finalizando...' : '¡Listo! Ir al dashboard'}
          </Button>
        )}
      </div>
    </div>
  )
}

function StepProfile({ business, publicUrl }: { business: OnboardingPageProps['business']; publicUrl: string }) {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-primary">Datos de tu negocio</h2>
      <p className="text-muted-foreground">
        Revisa la información de tu negocio. Puedes editarla en Configuración.
      </p>

      <div className="grid gap-4 rounded-lg bg-muted/30 p-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nombre</p>
          <p className="mt-1 font-semibold text-primary">{business.name}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subdominio</p>
          <p className="mt-1 break-all font-mono text-sm text-primary">{publicUrl}</p>
        </div>
        {business.city && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ciudad</p>
            <p className="mt-1 text-primary">{business.city}</p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">¿Quieres cambiar algo?</p>
        <p>Ve a Configuración en el menú lateral para editar el nombre, dirección, redes sociales y más.</p>
      </div>
    </div>
  )
}

function StepServices({ servicesCount }: { servicesCount: number }) {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-primary">Tus servicios</h2>
      <p className="text-muted-foreground">
        Los clientes elegirán entre estos servicios al reservar.
      </p>

      <div className="rounded-lg bg-muted/30 p-5 text-center">
        <p className="text-4xl font-semibold text-primary">{servicesCount}</p>
        <p className="mt-1 text-sm text-muted-foreground">servicios configurados</p>
      </div>

      {servicesCount === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Agrega al menos un servicio</p>
          <Link href="/dashboard/services">
            <Button variant="outline" className="mt-2">Ir a Servicios</Button>
          </Link>
        </div>
      ) : (
        <div className="rounded-lg border border-green-200 bg-green-50/50 p-4 text-sm text-green-800">
          <p>Servicios listos. Puedes agregar o editar más desde la sección Servicios.</p>
        </div>
      )}
    </div>
  )
}

function StepSchedule({ availabilityCount }: { availabilityCount: number }) {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-primary">Tus horarios</h2>
      <p className="text-muted-foreground">
        Define cuándo aceptas reservas. Los clientes solo podrán agendar en estos horarios.
      </p>

      <div className="rounded-lg bg-muted/30 p-5 text-center">
        <p className="text-4xl font-semibold text-primary">{availabilityCount}</p>
        <p className="mt-1 text-sm text-muted-foreground">días con horario configurado</p>
      </div>

      {availabilityCount === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Configura tus horarios</p>
          <Link href="/dashboard/availability">
            <Button variant="outline" className="mt-2">Ir a Horarios</Button>
          </Link>
        </div>
      ) : (
        <div className="rounded-lg border border-green-200 bg-green-50/50 p-4 text-sm text-green-800">
          <p>Horarios configurados. Puedes ajustarlos en la sección Horarios.</p>
        </div>
      )}
    </div>
  )
}

function StepPolicies() {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold text-primary">Políticas de reserva</h2>
      <p className="text-muted-foreground">
        Define las reglas para tus clientes sobre abonos, cancelaciones y más.
      </p>

      <div className="rounded-lg bg-muted/30 p-5 space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Abono</p>
          <p className="text-sm text-muted-foreground mt-1">
            Cada servicio tiene un monto de abono configurable. El abono se paga al momento de reservar.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cancelación</p>
          <p className="text-sm text-muted-foreground mt-1">
            Puedes definir tu política de cancelación en Configuración.
          </p>
        </div>
      </div>

      <Link href="/dashboard/settings">
        <Button variant="outline">Ir a Configuración</Button>
      </Link>
    </div>
  )
}

function StepPublish({
  publicUrl,
  bookingUrl,
  canPublish,
  copied,
  onCopy,
}: {
  publicUrl: string
  bookingUrl: string
  canPublish: boolean
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-100">
        <CheckCircle2 className="size-8 text-green-600" />
      </div>
      <div>
        <h2 className="text-2xl font-semibold text-primary">{canPublish ? '¡Tu negocio está listo!' : 'Faltan pasos para publicar'}</h2>
        <p className="mt-2 text-muted-foreground">
          {canPublish ? 'Comparte este link con tus clientes para que empiecen a reservar.' : 'Agrega servicios y horarios antes de marcar el negocio como listo.'}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex items-center gap-3">
          <code className="flex-1 rounded border border-border bg-card px-3 py-2 text-left font-mono text-sm text-primary break-all">
            {bookingUrl}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={onCopy}
            className="shrink-0"
          >
            <Copy className="size-4" />
            <span className="ml-2">{copied ? 'Copiado' : 'Copiar'}</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <a href={publicUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="outline">
            <ExternalLink className="mr-2 size-4" />
            Ver perfil público
          </Button>
        </a>
        <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
          <Button>
            <CalendarCheck2 className="mr-2 size-4" />
            Ir a la página de reserva
          </Button>
        </a>
      </div>
    </div>
  )
}
