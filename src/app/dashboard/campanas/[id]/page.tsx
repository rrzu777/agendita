import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { DashboardHeader } from '@/components/dashboard/header'
import { Button } from '@/components/ui/button'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { ForbiddenError } from '@/lib/auth/server'
import { getCampaignDetail } from '@/server/actions/campaigns'
import { segmentLabel } from '@/lib/campaigns/labels'
import { formatMediumDate } from '@/lib/format-date'
import { RecipientList } from './recipient-list'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function CampaignDetailPage({ params }: Props) {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  const { id } = await params

  let campaign
  let error: string | null = null
  try {
    campaign = await getCampaignDetail(id)
  } catch (err) {
    // Sólo not-found/ownership → 404; un error real (DB caída, etc.) muestra
    // la card de error, patrón customers/[id].
    if (err instanceof ForbiddenError) {
      notFound()
    }
    error = err instanceof Error ? err.message : 'Error al cargar la campaña'
  }

  if (error || !campaign) {
    return (
      <div>
        <DashboardHeader title="Campaña" subtitle="Detalle de campaña" />
        <div className="p-5 md:p-10">
          <div className="studio-card flex min-h-[320px] flex-col items-center justify-center p-8 text-center">
            <h2 className="text-xl font-semibold text-primary">Error al cargar</h2>
            <p className="mt-2 max-w-md text-muted-foreground">{error || 'No encontrada'}</p>
            <Link href="/dashboard/campanas">
              <Button className="mt-6" variant="outline">
                Volver a campañas
              </Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Métricas server-side.
  const now = new Date()
  const enviadas = campaign.recipients.filter((r) => r.sentAt != null).length
  const canjearon = campaign.recipients.filter((r) => r.grant?.status === 'redeemed').length
  const vigentes = campaign.recipients.filter(
    (r) => r.grant?.status === 'active' && (!r.grant.expiresAt || r.grant.expiresAt >= now),
  ).length

  // Serializamos lo justo para el client component.
  const recipients = campaign.recipients.map((r) => ({
    id: r.id,
    name: r.customer.name,
    phone: r.customer.phone,
    sentAt: r.sentAt,
    grantStatus: r.grant?.status ?? null,
    optedOut: r.customer.marketingOptOutAt != null,
  }))

  return (
    <div>
      <DashboardHeader
        title={campaign.name}
        subtitle={`${segmentLabel(campaign.segmentType)} · ${campaign.promotion.name} · ${formatMediumDate(campaign.createdAt)}`}
      />
      <div className="p-5 md:p-10">
        {/* Back link (patrón customers/[id]) */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Link href="/dashboard/campanas">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 size-4" />
              Campañas
            </Button>
          </Link>
        </div>

        <RecipientList
          recipients={recipients}
          metrics={{ enviadas, canjearon, vigentes }}
        />
      </div>
    </div>
  )
}
