import { ProfileSettingsForm } from '@/components/dashboard/settings/profile-settings-form'
import { requireSettingsPageAccess } from '@/lib/business/settings-access'
import { toProfileSettingsFormValues } from '@/lib/business/settings-form-values'

export default async function ProfileSettingsPage() {
  const { business } = await requireSettingsPageAccess()

  return (
    <ProfileSettingsForm
      businessId={business.id}
      slug={business.slug}
      initialValues={toProfileSettingsFormValues(business)}
    />
  )
}
