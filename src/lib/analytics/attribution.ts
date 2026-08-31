import { acquisitionSchema, channelSchema, dimensionIdSchema, type AcquisitionSource } from './contracts'

/** verifiedLink must come from a tenant-scoped server lookup, never directly from the browser body. */
export function normalizeAcquisition(input: unknown): AcquisitionSource {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const link = value.verifiedLink && typeof value.verifiedLink === 'object' ? value.verifiedLink as Record<string, unknown> : null
  if (link && dimensionIdSchema.safeParse(link.id).success && channelSchema.safeParse(link.channel).success) {
    return acquisitionSchema.parse({ channel: link.channel, acquisitionLinkId: link.id, normalizationVersion: 1 })
  }
  const source = typeof value.utmSource === 'string' ? value.utmSource.trim().toLowerCase() : ''
  const channels: Record<string, AcquisitionSource['channel']> = { instagram: 'instagram', ig: 'instagram', facebook: 'facebook', fb: 'facebook', whatsapp: 'whatsapp', google: 'google', referral: 'referral', other: 'other' }
  return { channel: source ? Object.hasOwn(channels, source) ? channels[source] : 'unknown' : value.referrer ? 'unknown' : 'direct', normalizationVersion: 1, acquisitionLinkId: null }
}
