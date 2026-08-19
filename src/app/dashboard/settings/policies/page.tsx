import { PolicySettingsForm } from '@/components/dashboard/settings/policy-settings-form'
import { requireSettingsPageAccess } from '@/lib/business/settings-access'
import { toPolicySettingsFormValues } from '@/lib/business/settings-form-values'

export default async function PolicySettingsPage() {
  const { business } = await requireSettingsPageAccess()
  const initialValues = toPolicySettingsFormValues(business)

  return <PolicySettingsForm businessId={business.id} initialValues={initialValues} />
}
