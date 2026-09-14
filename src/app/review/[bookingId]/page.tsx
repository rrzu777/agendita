import { Metadata } from 'next'
import { getReviewRequest } from '@/server/actions/reviews'
import { ReviewForm } from './review-form'
import { TenantPublicShell } from '@/components/client/client-shell'
import { MarketingShell } from '@/components/platform/platform-shell'

export const revalidate = 0

interface ReviewPageProps {
  params: Promise<{ bookingId: string }>
  searchParams: Promise<{ token?: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Reseña',
    robots: { index: false, follow: false },
  }
}

export default async function ReviewPage({ params, searchParams }: ReviewPageProps) {
  const { bookingId } = await params
  const { token } = await searchParams

  if (!token) {
    return (
      <MarketingShell><main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-4">
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-primary">Link inválido</h1>
          <p className="mt-2 text-muted-foreground">Este link de reseña no es válido. Asegúrate de usar el link completo que te compartieron.</p>
        </div>
      </main></MarketingShell>
    )
  }

  const reviewRequest = await getReviewRequest(bookingId, token)

  if (!reviewRequest) {
    return (
      <MarketingShell><main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-4">
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-primary">Link inválido</h1>
          <p className="mt-2 text-muted-foreground">Este link de reseña no existe o ya expiró. Si crees que es un error, contacta al negocio.</p>
        </div>
      </main></MarketingShell>
    )
  }

  if ('unavailableReason' in reviewRequest) {
    return (
      <TenantPublicShell business={reviewRequest.business} backHref={`/b/${reviewRequest.business.slug}`} backLabel="Volver al perfil" width="narrow">
        <div className="rounded-[var(--radius)] border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-primary">Reseña todavía no disponible</h1>
          <p className="mt-2 text-muted-foreground">{reviewRequest.unavailableReason}</p>
        </div>
      </TenantPublicShell>
    )
  }

  if (reviewRequest.alreadyReviewed) {
    return (
      <TenantPublicShell business={reviewRequest.business} backHref={`/b/${reviewRequest.business.slug}`} backLabel="Volver al perfil" width="narrow">
        <div className="rounded-[var(--radius)] border border-border bg-card p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-primary">¡Gracias!</h1>
          <p className="mt-2 text-muted-foreground">
            Ya enviaste tu reseña para <strong>{reviewRequest.serviceName}</strong> en <strong>{reviewRequest.businessName}</strong>.
          </p>
        </div>
      </TenantPublicShell>
    )
  }

  return (
    <TenantPublicShell business={reviewRequest.business} backHref={`/b/${reviewRequest.business.slug}`} backLabel="Volver al perfil" width="narrow">
      <div className="rounded-[var(--radius)] border border-border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold text-primary">Dejar una reseña</h1>
        <p className="mt-1 text-muted-foreground">
          Cuéntanos cómo te fue en <strong>{reviewRequest.serviceName}</strong> con <strong>{reviewRequest.businessName}</strong>
        </p>
        <ReviewForm bookingId={bookingId} token={token} />
      </div>
    </TenantPublicShell>
  )
}
