import { Metadata } from 'next'
import { getReviewRequest } from '@/server/actions/reviews'
import { ReviewForm } from './review-form'

export const revalidate = 0

interface ReviewPageProps {
  params: Promise<{ bookingId: string }>
  searchParams: Promise<{ token?: string }>
}

export async function generateMetadata({ params }: ReviewPageProps): Promise<Metadata> {
  const { bookingId: _bookingId } = await params
  return {
    title: `Reseña — Agendita`,
    robots: { index: false, follow: false },
  }
}

export default async function ReviewPage({ params, searchParams }: ReviewPageProps) {
  const { bookingId } = await params
  const { token } = await searchParams

  if (!token) {
    return (
      <main className="studio-shell flex min-h-screen items-center justify-center px-4">
        <div className="studio-card mx-auto max-w-md p-8 text-center">
          <h1 className="text-2xl font-semibold text-primary">Link inválido</h1>
          <p className="mt-2 text-muted-foreground">Este link de reseña no es válido. Asegúrate de usar el link completo que te compartieron.</p>
        </div>
      </main>
    )
  }

  let reviewRequest: Awaited<ReturnType<typeof getReviewRequest>>
  try {
    reviewRequest = await getReviewRequest(bookingId, token)
  } catch (e) {
    return (
      <main className="studio-shell flex min-h-screen items-center justify-center px-4">
        <div className="studio-card mx-auto max-w-md p-8 text-center">
          <h1 className="text-2xl font-semibold text-primary">Error</h1>
          <p className="mt-2 text-muted-foreground">{e instanceof Error ? e.message : 'Ocurrió un error inesperado.'}</p>
        </div>
      </main>
    )
  }

  if (!reviewRequest) {
    return (
      <main className="studio-shell flex min-h-screen items-center justify-center px-4">
        <div className="studio-card mx-auto max-w-md p-8 text-center">
          <h1 className="text-2xl font-semibold text-primary">Link inválido</h1>
          <p className="mt-2 text-muted-foreground">Este link de reseña no existe o ya expiró. Si crees que es un error, contacta al negocio.</p>
        </div>
      </main>
    )
  }

  if (reviewRequest.alreadyReviewed) {
    return (
      <main className="studio-shell flex min-h-screen items-center justify-center px-4">
        <div className="studio-card mx-auto max-w-md p-8 text-center">
          <h1 className="text-2xl font-semibold text-primary">¡Gracias!</h1>
          <p className="mt-2 text-muted-foreground">
            Ya enviaste tu reseña para <strong>{reviewRequest.serviceName}</strong> en <strong>{reviewRequest.businessName}</strong>.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="studio-shell flex min-h-screen items-center justify-center px-4 py-12">
      <div className="studio-card mx-auto w-full max-w-md p-8">
        <h1 className="text-2xl font-semibold text-primary">Dejar una reseña</h1>
        <p className="mt-1 text-muted-foreground">
          Cuéntanos cómo te fue en <strong>{reviewRequest.serviceName}</strong> con <strong>{reviewRequest.businessName}</strong>
        </p>
        <ReviewForm bookingId={bookingId} token={token} />
      </div>
    </main>
  )
}
