import { ProfileSettingsForm } from '@/components/dashboard/settings/profile-settings-form'
import { requireSettingsPageAccess } from '@/lib/business/settings-access'

export default async function ProfileSettingsPage() {
  const { business } = await requireSettingsPageAccess()

  return (
    <ProfileSettingsForm
      businessId={business.id}
      slug={business.slug}
      initialValues={{
        name: business.name,
        bio: business.bio ?? '',
        profileImageUrl: business.profileImageUrl ?? '',
        logoUrl: business.logoUrl ?? '',
        whatsapp: business.whatsapp ?? '',
        instagram: business.instagram ?? '',
        addressText: business.addressText ?? '',
        city: business.city,
        subdomain: business.subdomain,
      }}
    />
  )
}
