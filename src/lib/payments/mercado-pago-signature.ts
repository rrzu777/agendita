import { createHmac, timingSafeEqual } from 'node:crypto'

export type MercadoPagoSignatureInput = {
  resourceId: string | undefined
  requestId: string | null
  signatureHeader: string | null
  secret: string
}

function isTimestampFresh(timestamp: string): boolean {
  const toleranceRaw = process.env.MERCADO_PAGO_WEBHOOK_TOLERANCE_SECONDS
  if (!toleranceRaw) return true
  const tolerance = Number(toleranceRaw)
  if (!Number.isFinite(tolerance) || tolerance <= 0) return true

  const numericTimestamp = Number(timestamp)
  if (!Number.isFinite(numericTimestamp)) return false
  const timestampSeconds = numericTimestamp > 1e12
    ? Math.floor(numericTimestamp / 1_000)
    : numericTimestamp
  const nowSeconds = Math.floor(Date.now() / 1_000)
  return Math.abs(nowSeconds - timestampSeconds) <= tolerance
}

export function verifyMercadoPagoSignature(input: MercadoPagoSignatureInput): boolean {
  if (!input.resourceId || !input.signatureHeader) return false

  let timestamp = ''
  let digest = ''
  for (const part of input.signatureHeader.split(',')) {
    const [key, ...valueParts] = part.split('=')
    const value = valueParts.join('=')
    if (key.trim() === 'ts') timestamp = value.trim()
    if (key.trim() === 'v1') digest = value.trim()
  }

  if (!timestamp || !digest || !isTimestampFresh(timestamp)) return false

  const manifest = `id:${input.resourceId};request-id:${input.requestId ?? ''};ts:${timestamp};`
  const expected = createHmac('sha256', input.secret).update(manifest).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(digest))
  } catch {
    return false
  }
}
