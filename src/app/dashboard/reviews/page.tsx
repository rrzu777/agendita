import { redirect } from 'next/navigation'
import { DashboardHeader } from '@/components/dashboard/header'
import {
  getDashboardReviews,
  getPendingReviewCount,
  getCompletedBookingsWithoutReview,
} from '@/server/actions/reviews'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { ReviewsClient } from './reviews-client'

export default async function ReviewsPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.user) {
    redirect('/login')
  }

  if (!userData?.business) {
    redirect('/recover-business')
  }

  let reviews: Awaited<ReturnType<typeof getDashboardReviews>> = []
  let pendingCount = 0
  let eligibleBookings: Awaited<ReturnType<typeof getCompletedBookingsWithoutReview>> = []

  try {
    // Load every review once; filtering/search happens instantly on the client.
    reviews = await getDashboardReviews({ status: 'all' })
    pendingCount = await getPendingReviewCount()
    eligibleBookings = await getCompletedBookingsWithoutReview()
  } catch {
    // Auth error fallback
  }

  return (
    <div>
      <DashboardHeader title="Reseñas" subtitle="Modera y administra las reseñas de tus clientes." />
      <div className="p-5 md:p-10">
        <ReviewsClient
          reviews={reviews}
          eligibleBookings={eligibleBookings}
          pendingCount={pendingCount}
        />
      </div>
    </div>
  )
}
