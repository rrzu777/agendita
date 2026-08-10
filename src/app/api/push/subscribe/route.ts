import { checkRateLimit } from '@/lib/rate-limit'
import { normalizePushSubscription, storePushSubscription } from '@/lib/push/subscription'
import {
  hasCanonicalOrigin,
  hasCompletePushConfig,
  readBoundedJson,
  resolvePushTargets,
} from '@/lib/push/routes'

const JSON_HEADERS = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  if (!hasCanonicalOrigin(request)) {
    return Response.json({ error: 'Solicitud no autorizada' }, { status: 403, headers: JSON_HEADERS })
  }

  const limit = await checkRateLimit('push-subscribe', 10, 60_000)
  if (!limit.success) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429, headers: JSON_HEADERS })
  }
  if (!hasCompletePushConfig()) {
    return Response.json({ error: 'Recordatorios no disponibles' }, { status: 503, headers: JSON_HEADERS })
  }

  try {
    const body = await readBoundedJson(request)
    const subscription = normalizePushSubscription(body.subscription)
    const targets = await resolvePushTargets(body.grant)
    if (!targets) {
      return Response.json({ error: 'Solicitud no autorizada' }, { status: 401, headers: JSON_HEADERS })
    }

    await Promise.all(targets.map((target) => storePushSubscription({ ...target, subscription })))
    return Response.json({ subscribed: targets.length }, { headers: JSON_HEADERS })
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400, headers: JSON_HEADERS })
  }
}
