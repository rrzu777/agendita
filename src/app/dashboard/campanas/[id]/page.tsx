import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { DashboardHeader } from '@/components/dashboard/header'
import { Button } from '@/components/ui/button'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getCampaignDetail } from '@/server/actions/campaigns'
import { segmentLabel } from '@/lib/campaigns/labels'
import { RecipientList } from './recipient-list'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

function formatDate(value: Date) {
  return new Date(value).toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: 'numeric' })
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
  try {
    campaign = await getCampaignDetail(id)
  } catch {
    notFound()
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
  }))

  return (
    <div>
      <DashboardHeader title={campaign.name} subtitle="Detalle de campaña" />
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

        <div className="mb-6">
          <h2 className="font-heading text-2xl font-semibold tracking-tight text-primary">{campaign.name}</h2>
          <p className="text-sm text-muted-foreground">
            {segmentLabel(campaign.segmentType)} · {campaign.promotion.name} · {formatDate(campaign.createdAt)}
          </p>
        </div>

        <RecipientList
          recipients={recipients}
          metrics={{ total: campaign.recipients.length, enviadas, canjearon, vigentes }}
        />
      </div>
    </div>
  )
}
