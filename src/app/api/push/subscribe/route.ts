import { checkRateLimit } from '@/lib/rate-limit'
import {
  normalizePushSubscription,
  storeAuthenticatedPushSubscriptions,
  storePushSubscription,
} from '@/lib/push/subscription'
import {
  hasCanonicalOrigin,
  hasCompletePushConfig,
  readBoundedJson,
  resolvePushSubscribeScope,
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
    const scope = await resolvePushSubscribeScope(body.grant)
    if (!scope) {
      return Response.json({ error: 'Solicitud no autorizada' }, { status: 401, headers: JSON_HEADERS })
    }

    const targetLimit = await checkRateLimit(
      'push-subscribe-target',
      10,
      60_000,
      pushTargetRateLimitContext(scope),
    )
    if (!targetLimit.success) {
      return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429, headers: JSON_HEADERS })
    }

    const subscribed = scope.kind === 'guest'
      ? await storePushSubscription({ ...scope.target, subscription }).then(() => 1)
      : await storeAuthenticatedPushSubscriptions({
          userId: scope.userId,
          subscription,
          now: new Date(),
        })
    return Response.json({ subscribed }, { headers: JSON_HEADERS })
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400, headers: JSON_HEADERS })
  }
}
