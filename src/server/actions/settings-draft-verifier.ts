'use server'

import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { UserError } from '@/lib/actions/result'
import { settingsFingerprint, type FlatSettings } from '@/lib/business/settings-draft'
import {
  toBankTransferFormValues,
  toPolicySettingsFormValues,
  toProfileSettingsFormValues,
  toReservationSettingsFormValues,
  type SettingsDraftScope,
} from '@/lib/business/settings-form-values'

export async function verifySettingsDraftBaseline(scope: SettingsDraftScope, fingerprint: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  let current: FlatSettings

  switch (scope) {
    case 'profile': {
      const business = await prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          name: true,
          bio: true,
          profileImageUrl: true,
          logoUrl: true,
          whatsapp: true,
          instagram: true,
          addressText: true,
          city: true,
          subdomain: true,
        },
      })
      current = toProfileSettingsFormValues(business)
      break
    }
    case 'reservations': {
      const business = await prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          timezone: true,
          slotStepMinutes: true,
          manualHoldHours: true,
          requireBookingApproval: true,
          defaultMeetingUrl: true,
        },
      })
      current = toReservationSettingsFormValues(business)
      break
    }
    case 'policies': {
      const business = await prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          selfServiceCutoffHours: true,
          cancellationReminderEnabled: true,
          cancellationPolicy: true,
          bookingPolicy: true,
          depositPolicy: true,
        },
      })
      current = toPolicySettingsFormValues(business)
      break
    }
    case 'payments-bank': {
      const account = await prisma.bankTransferAccount.findUnique({
        where: { businessId },
        select: {
          accountHolder: true,
          rut: true,
          bankName: true,
          accountType: true,
          accountNumber: true,
          email: true,
          instructions: true,
          holdHours: true,
          verifyHours: true,
        },
      })
      current = toBankTransferFormValues(account)
      break
    }
    default:
      throw new UserError('Sección de configuración inválida')
  }

  return { matches: await settingsFingerprint(current) === fingerprint, current }
}
