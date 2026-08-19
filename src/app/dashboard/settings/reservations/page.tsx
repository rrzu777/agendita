import { ReservationSettingsForm } from '@/components/dashboard/settings/reservation-settings-form'
import type { ReservationSettingsInput } from '@/lib/business/schema'
import { requireSettingsPageAccess } from '@/lib/business/settings-access'

export default async function ReservationSettingsPage() {
  const { business } = await requireSettingsPageAccess()
  const initialValues: ReservationSettingsInput = {
    timezone: business.timezone,
    slotStepMinutes: business.slotStepMinutes == null ? 'service' : String(business.slotStepMinutes) as ReservationSettingsInput['slotStepMinutes'],
    manualHoldHours: business.manualHoldHours,
    requireBookingApproval: business.requireBookingApproval,
    defaultMeetingUrl: business.defaultMeetingUrl ?? '',
  }

  return <ReservationSettingsForm businessId={business.id} initialValues={initialValues} />
}
