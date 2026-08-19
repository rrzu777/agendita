import { PolicySettingsForm } from '@/components/dashboard/settings/policy-settings-form'
import type { PolicySettingsInput } from '@/lib/business/schema'
import { requireSettingsPageAccess } from '@/lib/business/settings-access'

export default async function PolicySettingsPage() {
  const { business } = await requireSettingsPageAccess()
  const initialValues: PolicySettingsInput = {
    selfServiceCutoffHours: business.selfServiceCutoffHours,
    cancellationReminderEnabled: business.cancellationReminderEnabled,
    cancellationPolicy: business.cancellationPolicy ?? '',
    bookingPolicy: business.bookingPolicy ?? '',
    depositPolicy: business.depositPolicy ?? '',
  }

  return <PolicySettingsForm businessId={business.id} initialValues={initialValues} />
}
