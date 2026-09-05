import { z } from 'zod'
import { isWeeklyActionId } from './actions'

export const weeklyNarrativeSchema = z.strictObject({
  summary: z.string().trim().min(1).max(320),
  findings: z.array(z.strictObject({ factId: z.string().trim().min(1).max(96), actionId: z.string().trim().min(1).max(64), statement: z.string().trim().min(1).max(280) })).max(3),
  caveats: z.array(z.enum(['limited_population', 'coverage_complete', 'deterministic_only', 'no_causal_claim'])).max(5),
})

export type WeeklyNarrative = z.infer<typeof weeklyNarrativeSchema>

export function validateWeeklyNarrative(value: unknown, allowedFactIds: Set<string>, allowedActionIds: Set<string>): WeeklyNarrative {
  const parsed = weeklyNarrativeSchema.parse(value)
  for (const finding of parsed.findings) {
    if (!allowedFactIds.has(finding.factId) || !allowedActionIds.has(finding.actionId) || !isWeeklyActionId(finding.actionId)) throw new Error('narrative_invalid_reference')
  }
  return parsed
}
