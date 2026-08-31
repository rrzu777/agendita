import { handleAnalyticsPost } from '@/lib/analytics/ingest'

export const runtime = 'nodejs'
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  return handleAnalyticsPost(request, (await context.params).slug, 'events')
}
