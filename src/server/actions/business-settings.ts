'use server'

import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { checkRateLimit } from '@/lib/rate-limit'
import { revalidateBusinessPublicPaths } from './revalidate-business'
import { requireBusinessRole } from '@/lib/auth/server'
import { action, UserError } from '@/lib/actions/result'
import {
  policySettingsSchema,
  profileSettingsSchema,
  reservationSettingsSchema,
  slotStepToMinutes,
  updateBusinessSchema,
  type PolicySettingsInput,
  type ProfileSettingsInput,
  type ReservationSettingsInput,
  type UpdateBusinessInput,
} from '@/lib/business/schema'
import { normalizeWhatsapp, normalizeInstagram } from '@/lib/business/normalize'
import { z } from 'zod'

const RESERVED_SUBDOMAINS = [
  'www', 'app', 'admin', 'dashboard', 'api', 'login', 'register', 'support',
]

// NOTE: a 'use server' module must only export async functions. Don't re-export
// the Zod schema OR types here — the 'use server' transform turns every export
// into a runtime server reference, so even `export type { UpdateBusinessInput }`
// emits a reference to a value that doesn't exist at runtime (types are erased),
// throwing `ReferenceError: UpdateBusinessInput is not defined` when the action
// runs. Import the schema and types directly from '@/lib/business/schema'.

function trimToNull(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null
  return value.trim()
}

async function enforceSettingsRateLimit() {
  const limit = await checkRateLimit('update-business-settings', 20, 60_000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }
}

function parseSettings<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(issue => issue.message).join(', '))
  }
  return parsed.data
}

async function _updateProfileSettings(data: ProfileSettingsInput) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  await enforceSettingsRateLimit()
  const validated = parseSettings(profileSettingsSchema, data)

  if (RESERVED_SUBDOMAINS.includes(validated.subdomain)) {
    throw new UserError('Este subdominio está reservado')
  }

  const existing = await prisma.business.findFirst({
    where: {
      subdomain: validated.subdomain,
      NOT: { id: businessId },
    },
  })
  if (existing) {
    throw new UserError('Este subdominio ya está en uso')
  }

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: {
      name: validated.name,
      bio: trimToNull(validated.bio),
      profileImageUrl: trimToNull(validated.profileImageUrl),
      logoUrl: trimToNull(validated.logoUrl),
      whatsapp: normalizeWhatsapp(validated.whatsapp) || null,
      instagram: normalizeInstagram(validated.instagram) || null,
      addressText: trimToNull(validated.addressText),
      city: validated.city,
      subdomain: validated.subdomain,
    },
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

  revalidatePath('/dashboard/settings/profile')
  await revalidateBusinessPublicPaths(businessId)

  return {
    name: updated.name,
    bio: updated.bio ?? '',
    profileImageUrl: updated.profileImageUrl ?? '',
    logoUrl: updated.logoUrl ?? '',
    whatsapp: updated.whatsapp ?? '',
    instagram: updated.instagram ?? '',
    addressText: updated.addressText ?? '',
    city: updated.city,
    subdomain: updated.subdomain,
  } satisfies ProfileSettingsInput
}

async function _updateReservationSettings(data: ReservationSettingsInput) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  await enforceSettingsRateLimit()
  const validated = parseSettings(reservationSettingsSchema, data)
  const updated = await prisma.business.update({
    where: { id: businessId },
    data: {
      timezone: validated.timezone,
      slotStepMinutes: slotStepToMinutes(validated.slotStepMinutes),
      manualHoldHours: validated.manualHoldHours,
      requireBookingApproval: validated.requireBookingApproval,
      defaultMeetingUrl: trimToNull(validated.defaultMeetingUrl),
    },
    select: {
      timezone: true,
      slotStepMinutes: true,
      manualHoldHours: true,
      requireBookingApproval: true,
      defaultMeetingUrl: true,
    },
  })

  revalidatePath('/dashboard/settings/reservations')
  await revalidateBusinessPublicPaths(businessId)

  return {
    timezone: updated.timezone,
    // `validated` constrains every value this action can persist to the form
    // enum; Prisma models the legacy column as any number.
    slotStepMinutes: updated.slotStepMinutes == null
      ? 'service'
      : String(updated.slotStepMinutes) as typeof validated.slotStepMinutes,
    manualHoldHours: updated.manualHoldHours,
    requireBookingApproval: updated.requireBookingApproval,
    defaultMeetingUrl: updated.defaultMeetingUrl ?? '',
  } satisfies ReservationSettingsInput
}

async function _updatePolicySettings(data: PolicySettingsInput) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  await enforceSettingsRateLimit()
  const validated = parseSettings(policySettingsSchema, data)
  const updated = await prisma.business.update({
    where: { id: businessId },
    data: {
      selfServiceCutoffHours: validated.selfServiceCutoffHours,
      cancellationReminderEnabled: validated.cancellationReminderEnabled,
      cancellationPolicy: trimToNull(validated.cancellationPolicy),
      bookingPolicy: trimToNull(validated.bookingPolicy),
      depositPolicy: trimToNull(validated.depositPolicy),
    },
    select: {
      selfServiceCutoffHours: true,
      cancellationReminderEnabled: true,
      cancellationPolicy: true,
      bookingPolicy: true,
      depositPolicy: true,
    },
  })

  revalidatePath('/dashboard/settings/policies')
  await revalidateBusinessPublicPaths(businessId)

  return {
    selfServiceCutoffHours: updated.selfServiceCutoffHours,
    cancellationReminderEnabled: updated.cancellationReminderEnabled,
    cancellationPolicy: updated.cancellationPolicy ?? '',
    bookingPolicy: updated.bookingPolicy ?? '',
    depositPolicy: updated.depositPolicy ?? '',
  } satisfies PolicySettingsInput
}

async function _updateBusinessSettings(data: UpdateBusinessInput) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])

  const limit = await checkRateLimit('update-business-settings', 20, 60000)
  if (!limit.success) {
    throw new UserError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.')
  }

  const parsed = updateBusinessSchema.safeParse(data)
  if (!parsed.success) {
    throw new UserError('Datos inválidos: ' + parsed.error.issues.map(i => i.message).join(', '))
  }

  const validated = parsed.data

  if (RESERVED_SUBDOMAINS.includes(validated.subdomain)) {
    throw new UserError('Este subdominio está reservado')
  }

  const existing = await prisma.business.findFirst({
    where: {
      subdomain: validated.subdomain,
      NOT: { id: businessId },
    },
  })
  if (existing) {
    throw new UserError('Este subdominio ya está en uso')
  }

  const updateData = {
    name: validated.name.trim(),
    bio: trimToNull(validated.bio),
    profileImageUrl: trimToNull(validated.profileImageUrl),
    logoUrl: trimToNull(validated.logoUrl),
    whatsapp: normalizeWhatsapp(validated.whatsapp) || null,
    instagram: normalizeInstagram(validated.instagram) || null,
    addressText: trimToNull(validated.addressText),
    city: validated.city.trim(),
    timezone: validated.timezone,
    slotStepMinutes: slotStepToMinutes(validated.slotStepMinutes),
    selfServiceCutoffHours: validated.selfServiceCutoffHours,
    cancellationReminderEnabled: validated.cancellationReminderEnabled,
    manualHoldHours: validated.manualHoldHours,
    requireBookingApproval: validated.requireBookingApproval,
    defaultMeetingUrl: trimToNull(validated.defaultMeetingUrl),
    subdomain: validated.subdomain,
    cancellationPolicy: trimToNull(validated.cancellationPolicy),
    bookingPolicy: trimToNull(validated.bookingPolicy),
    depositPolicy: trimToNull(validated.depositPolicy),
  }

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: updateData,
  })

  revalidatePath('/dashboard/settings')
  await revalidateBusinessPublicPaths(businessId)

  return updated
}

export const updateBusinessSettings = action(_updateBusinessSettings)
export const updateProfileSettings = action(_updateProfileSettings)
export const updateReservationSettings = action(_updateReservationSettings)
export const updatePolicySettings = action(_updatePolicySettings)
