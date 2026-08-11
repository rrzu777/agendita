const monthlyLocal = [
  'tests/unit/payment-qa-network-deny.test.ts',
  'src/lib/payments/mercado-pago-signature.test.ts',
  'src/app/api/webhooks/mercado-pago/subscriptions/route.test.ts',
  'src/lib/subscriptions/webhook.test.ts',
  'src/app/api/mercado-pago/subscriptions/callback/route.test.ts',
  'src/lib/subscriptions/reconciliation.test.ts',
  'src/lib/subscriptions/state-machine.test.ts',
  'src/lib/cron/subscription-billing.test.ts',
  'src/server/actions/admin-subscriptions.test.ts',
  'src/server/actions/subscription-billing.test.ts',
  'src/server/actions/subscriptions.test.ts',
  'src/lib/subscriptions/mercado-pago-client.test.ts',
  'src/lib/notifications/subscriptions.test.ts',
  'src/lib/notifications/subscriptions-email-provider.test.ts',
]

const tenantLocal = [
  'src/lib/payments/mercado-pago-oauth.test.ts',
  'src/lib/payments/factory.oauth-refresh.test.ts',
  'src/app/api/mercado-pago/callback/route.test.ts',
  'src/lib/payments/create-preference.test.ts',
  'tests/unit/mercado-pago-webhook.test.ts',
  'tests/unit/mercado-pago-webhook-packages.test.ts',
]

const postgres = [
  'src/lib/subscriptions/webhook.integration.test.ts',
  'src/lib/subscriptions/transition.integration.test.ts',
  'src/lib/cron/subscription-billing.integration.test.ts',
  'src/lib/payments/mercado-pago-oauth.integration.test.ts',
  'tests/integration/finance.package-online.integration.test.ts',
  'tests/integration/mercado-pago-environment-persistence.test.ts',
]

const scenarios = {
  'monthly.signed_webhook_duplicate': [
    'src/lib/payments/mercado-pago-signature.test.ts',
    'src/app/api/webhooks/mercado-pago/subscriptions/route.test.ts',
    'src/lib/subscriptions/webhook.test.ts',
    'src/lib/subscriptions/webhook.integration.test.ts',
  ],
  'monthly.callback_non_authoritative': [
    'src/app/api/mercado-pago/subscriptions/callback/route.test.ts',
  ],
  'monthly.reconciliation': [
    'src/lib/subscriptions/reconciliation.test.ts',
    'src/lib/cron/subscription-billing.integration.test.ts',
  ],
  'monthly.trial_reminders_exemption_grace_enforcement_cancel': [
    'src/lib/subscriptions/state-machine.test.ts',
    'src/lib/cron/subscription-billing.test.ts',
    'src/lib/subscriptions/transition.integration.test.ts',
  ],
  'monthly.hosted_checkout': [
    'src/server/actions/subscription-billing.test.ts',
    'src/server/actions/subscriptions.test.ts',
    'src/lib/subscriptions/mercado-pago-client.test.ts',
  ],
  'monthly.notifications_email_delivery': [
    'src/lib/notifications/subscriptions.test.ts',
    'src/lib/notifications/subscriptions-email-provider.test.ts',
    'src/lib/subscriptions/transition.integration.test.ts',
  ],
  'tenant.oauth_environment_refresh': [
    'src/lib/payments/mercado-pago-oauth.test.ts',
    'src/lib/payments/factory.oauth-refresh.test.ts',
    'src/app/api/mercado-pago/callback/route.test.ts',
    'src/lib/payments/mercado-pago-oauth.integration.test.ts',
    'tests/integration/mercado-pago-environment-persistence.test.ts',
  ],
  'tenant.booking_exactly_once': [
    'src/lib/payments/create-preference.test.ts',
    'tests/unit/mercado-pago-webhook.test.ts',
  ],
  'tenant.package_exactly_once': [
    'tests/unit/mercado-pago-webhook-packages.test.ts',
    'tests/integration/finance.package-online.integration.test.ts',
  ],
}

module.exports = { monthlyLocal, tenantLocal, postgres, scenarios }
