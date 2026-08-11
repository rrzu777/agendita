import { checkRateLimit } from '@/lib/rate-limit'
import { hasActivePushAssociation } from '@/lib/push/subscription'
import {
  hasCanonicalOrigin,
  pushStatusRateLimitContext,
  readBoundedJson,
  resolvePushStatusScope,
  validPushEndpoint,
} from '@/lib/push/routes'

const JSON_HEADERS = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  if (!hasCanonicalOrigin(request)) {
    return Response.json(
      { error: 'Solicitud no autorizada' },
      { status: 403, headers: JSON_HEADERS },
    )
  }

  const limit = await checkRateLimit('push-status', 30, 60_000)
  if (!limit.success) {
    return Response.json(
      { error: 'Demasiadas solicitudes' },
      { status: 429, headers: JSON_HEADERS },
    )
  }

  try {
    const body = await readBoundedJson(request)
    if (!validPushEndpoint(body.endpoint)) {
      return Response.json(
        { error: 'Solicitud inválida' },
        { status: 400, headers: JSON_HEADERS },
      )
    }
    const scope = await resolvePushStatusScope(body.grant)
    if (!scope) {
      return Response.json(
        { error: 'Solicitud no autorizada' },
        { status: 401, headers: JSON_HEADERS },
      )
    }

    const targetLimit = await checkRateLimit(
      'push-status-target',
      30,
      60_000,
      pushStatusRateLimitContext(body.endpoint),
    )
    if (!targetLimit.success) {
      return Response.json(
        { error: 'Demasiadas solicitudes' },
        { status: 429, headers: JSON_HEADERS },
      )
    }

    const associated = await hasActivePushAssociation({
      endpoint: body.endpoint,
      scope,
    })
    return Response.json({ associated }, { headers: JSON_HEADERS })
  } catch {
    return Response.json(
      { error: 'Solicitud inválida' },
      { status: 400, headers: JSON_HEADERS },
    )
  }
}
