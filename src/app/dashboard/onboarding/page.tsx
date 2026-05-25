import { redirect } from 'next/navigation'
import { getCurrentUserWithBusiness } from '@/lib/auth/user'
import { getBusinessPublicUrl } from '@/lib/business/urls'
import { prisma } from '@/lib/db'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'

export default async function OnboardingPage() {
  const userData = await getCurrentUserWithBusiness()

  if (!userData?.business) {
    redirect('/login')
  }

  const business = userData.business

  if (business.onboardingCompletedAt) {
    redirect('/dashboard')
  }

  const [servicesCount, availabilityCount] = await Promise.all([
    prisma.service.count({ where: { businessId: business.id, isActive: true } }),
    prisma.availabilityRule.count({ where: { businessId: business.id, isActive: true } }),
  ])

  const publicUrl = getBusinessPublicUrl(business)
  const bookingUrl = getBusinessPublicUrl(business, '/book')

  return (
    <OnboardingWizard
      business={{
        id: business.id,
        name: business.name,
        subdomain: business.subdomain,
        slug: business.slug,
        bio: business.bio,
        addressText: business.addressText,
        whatsapp: business.whatsapp,
        instagram: business.instagram,
        city: business.city,
        depositPolicy: business.depositPolicy,
        cancellationPolicy: business.cancellationPolicy,
        bookingPolicy: business.bookingPolicy,
        onboardingStep: business.onboardingStep,
      }}
      servicesCount={servicesCount}
      availabilityCount={availabilityCount}
      publicUrl={publicUrl}
      bookingUrl={bookingUrl}
    />
  )
}
