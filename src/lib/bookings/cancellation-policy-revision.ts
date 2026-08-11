import { createHash } from 'node:crypto'

const POLICY_REVISION_DOMAIN = 'agendita-cancellation-policy-v1'

/** Hash of the exact structured cutoff and additional policy shown at checkout. */
export function cancellationPolicyRevision({
  businessId,
  cutoffHours,
  additionalPolicy,
}: {
  businessId: string
  cutoffHours: number
  additionalPolicy: string | null
}): string {
  return createHash('sha256')
    .update(JSON.stringify([
      POLICY_REVISION_DOMAIN,
      businessId,
      cutoffHours,
      additionalPolicy,
    ]), 'utf8')
    .digest('hex')
}
