import webPush from 'web-push'
import type { NormalizedPushSubscription } from './subscription'

export type WebPushPayload = {
  title: string
  body: string
  url: string
}

export type WebPushResult = {
  ok: boolean
  statusCode?: number
}

function vapidConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}

function providerStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined
  const statusCode = (error as { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' ? statusCode : undefined
}

export async function sendWebPush(
  subscription: NormalizedPushSubscription,
  payload: WebPushPayload,
): Promise<WebPushResult> {
  const config = vapidConfig()
  if (!config) return { ok: false }

  try {
    webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey)
    const response = await webPush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 0,
      timeout: 10_000,
    })
    return response.statusCode === undefined
      ? { ok: true }
      : { ok: true, statusCode: response.statusCode }
  } catch (error) {
    const statusCode = providerStatus(error)
    return statusCode === undefined ? { ok: false } : { ok: false, statusCode }
  }
}
