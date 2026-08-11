import { checkRateLimit } from '@/lib/rate-limit'
import { unsubscribePushSubscription } from '@/lib/push/subscription'
import {
  hasCanonicalOrigin,
  pushUnsubscribeRateLimitContext,
  readBoundedJson,
  resolvePushUnsubscribeScope,
  validPushEndpoint,
} from '@/lib/push/routes'

const JSON_HEADERS = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  if (!hasCanonicalOrigin(request)) {
    return Response.json({ error: 'Solicitud no autorizada' }, { status: 403, headers: JSON_HEADERS })
  }

  const limit = await checkRateLimit('push-unsubscribe', 10, 60_000)
  if (!limit.success) {
    return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429, headers: JSON_HEADERS })
  }

  try {
    const body = await readBoundedJson(request)
    if (!validPushEndpoint(body.endpoint)) {
      return Response.json({ error: 'Solicitud inválida' }, { status: 400, headers: JSON_HEADERS })
    }
    const scope = await resolvePushUnsubscribeScope(body.grant)
    if (!scope) {
      return Response.json({ error: 'Solicitud no autorizada' }, { status: 401, headers: JSON_HEADERS })
    }

    const targetLimit = await checkRateLimit(
      'push-unsubscribe-target',
      10,
      60_000,
      pushUnsubscribeRateLimitContext(scope),
    )
    if (!targetLimit.success) {
      return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429, headers: JSON_HEADERS })
    }

    const count = await unsubscribePushSubscription({
      endpoint: body.endpoint,
      scope,
      now: new Date(),
    })

    return Response.json({ unsubscribed: count }, { headers: JSON_HEADERS })
  } catch {
    return Response.json({ error: 'Solicitud inválida' }, { status: 400, headers: JSON_HEADERS })
  }
}
