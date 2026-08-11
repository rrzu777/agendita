import { checkRateLimit } from '@/lib/rate-limit'
import {
  normalizePushSubscription,
  PushDeviceLimitError,
  storePushSubscription,
} from '@/lib/push/subscription'
import {
  hasCanonicalOrigin,
  hasCompletePushConfig,
  readBoundedJson,
  resolvePushTargets,
  pushTargetRateLimitContext,
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

    const targetLimits = await Promise.all(targets.map((target) => checkRateLimit(
      'push-subscribe-target',
      10,
      60_000,
      pushTargetRateLimitContext(target),
    )))
    if (targetLimits.some(({ success }) => !success)) {
      return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429, headers: JSON_HEADERS })
    }

    const stored = await Promise.allSettled(
      targets.map((target) => storePushSubscription({ ...target, subscription })),
    )
    for (const result of stored) {
      if (result.status === 'rejected' && !(result.reason instanceof PushDeviceLimitError)) {
        throw result.reason
      }
    }
    const subscribed = stored.filter(({ status }) => status === 'fulfilled').length
    if (targets.length > 0 && subscribed === 0) throw new PushDeviceLimitError()
    return Response.json({ subscribed }, { headers: JSON_HEADERS })
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400, headers: JSON_HEADERS })
  }
}
