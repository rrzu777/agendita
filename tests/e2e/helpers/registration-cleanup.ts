type CleanupStep = () => Promise<void>

export async function runIndependentRegistrationCleanup({
  auth,
  database,
}: {
  auth: CleanupStep
  database: CleanupStep
}) {
  const results = await Promise.allSettled([auth(), database()])
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  )

  if (failures.length > 0) {
    throw new AggregateError(failures, `Registration cleanup failed in ${failures.length} steps`)
  }
}
