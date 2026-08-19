import { ReservationSettingsForm } from '@/components/dashboard/settings/reservation-settings-form'
import { requireSettingsPageAccess } from '@/lib/business/settings-access'
import { toReservationSettingsFormValues } from '@/lib/business/settings-form-values'

export default async function ReservationSettingsPage() {
  const { business } = await requireSettingsPageAccess()
  const initialValues = toReservationSettingsFormValues(business)

  return <ReservationSettingsForm businessId={business.id} initialValues={initialValues} />
}
