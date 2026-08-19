import {
  type PolicySettingsInput,
  type ProfileSettingsInput,
  type ReservationSettingsInput,
} from '@/lib/business/schema'
import { DEFAULT_HOLD_HOURS, DEFAULT_VERIFY_HOURS } from '@/lib/bank-transfer/schema'

export type SettingsDraftScope = 'profile' | 'reservations' | 'policies' | 'payments-bank'

export type BankTransferFormValues = {
  accountHolder: string
  rut: string
  bankName: string
  accountType: string
  accountNumber: string
  email: string
  instructions: string
  holdHours: string
  verifyHours: string
}

export type BankTransferSettingsRecord = {
  accountHolder: string
  rut: string
  bankName: string
  accountType: string
  accountNumber: string
  email: string | null
  instructions: string | null
  holdHours: number
  verifyHours: number | null
}

export function toProfileSettingsFormValues(business: {
  name: string
  bio: string | null
  profileImageUrl: string | null
  logoUrl: string | null
  whatsapp: string | null
  instagram: string | null
  addressText: string | null
  city: string
  subdomain: string
}): ProfileSettingsInput {
  return {
    name: business.name,
    bio: business.bio ?? '',
    profileImageUrl: business.profileImageUrl ?? '',
    logoUrl: business.logoUrl ?? '',
    whatsapp: business.whatsapp ?? '',
    instagram: business.instagram ?? '',
    addressText: business.addressText ?? '',
    city: business.city,
    subdomain: business.subdomain,
  }
}

export function toReservationSettingsFormValues(business: {
  timezone: string
  slotStepMinutes: number | null
  manualHoldHours: number
  requireBookingApproval: boolean
  defaultMeetingUrl: string | null
}): ReservationSettingsInput {
  return {
    timezone: business.timezone,
    slotStepMinutes: business.slotStepMinutes == null
      ? 'service'
      : String(business.slotStepMinutes) as ReservationSettingsInput['slotStepMinutes'],
    manualHoldHours: business.manualHoldHours,
    requireBookingApproval: business.requireBookingApproval,
    defaultMeetingUrl: business.defaultMeetingUrl ?? '',
  }
}

export function toPolicySettingsFormValues(business: {
  selfServiceCutoffHours: number
  cancellationReminderEnabled: boolean
  cancellationPolicy: string | null
  bookingPolicy: string | null
  depositPolicy: string | null
}): PolicySettingsInput {
  return {
    selfServiceCutoffHours: business.selfServiceCutoffHours,
    cancellationReminderEnabled: business.cancellationReminderEnabled,
    cancellationPolicy: business.cancellationPolicy ?? '',
    bookingPolicy: business.bookingPolicy ?? '',
    depositPolicy: business.depositPolicy ?? '',
  }
}

export function toBankTransferFormValues(account: BankTransferSettingsRecord | null): BankTransferFormValues {
  return {
    accountHolder: account?.accountHolder ?? '',
    rut: account?.rut ?? '',
    bankName: account?.bankName ?? '',
    accountType: account?.accountType ?? '',
    accountNumber: account?.accountNumber ?? '',
    email: account?.email ?? '',
    instructions: account?.instructions ?? '',
    holdHours: String(account?.holdHours ?? DEFAULT_HOLD_HOURS),
    verifyHours: account ? String(account.verifyHours ?? '') : String(DEFAULT_VERIFY_HOURS),
  }
}
