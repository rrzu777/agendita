import { hasValidBearerSecret } from '@/lib/auth/bearer-secret'
import { runSubscriptionBillingCron } from '@/lib/cron/subscription-billing'
import { logger } from '@/lib/logger'

const failedResult = {
  processed: 0,
  reconciled: 0,
  notified: 0,
  suspended: 0,
  errors: 1,
}

async function handler(request: Request) {
  if (!hasValidBearerSecret(request, process.env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runSubscriptionBillingCron({ now: new Date() })
    logger.info(
      'subscription_billing_cron.completed',
      'Subscription billing cron completed.',
      { metadata: result },
    )
    return Response.json(result, { status: result.errors > 0 ? 500 : 200 })
  } catch {
    logger.error(
      'subscription_billing_cron.failed',
      'Subscription billing cron failed before processing completed.',
    )
    return Response.json(failedResult, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
