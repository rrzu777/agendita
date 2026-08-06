import { prisma } from '@/lib/db'
import { DEPENDENCY_TIMEOUT_MS } from '@/lib/health/dependencies'

export async function probeDatabase(): Promise<'up' | 'down'> {
  try {
    await prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT 1`
      },
      {
        maxWait: 1_000,
        timeout: DEPENDENCY_TIMEOUT_MS - 1_000,
      },
    )
    return 'up'
  } catch {
    return 'down'
  }
}
