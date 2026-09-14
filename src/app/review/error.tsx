'use client'
import { ClientRouteError } from '@/components/client/client-route-error'
export default function ReviewError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) { return <ClientRouteError area="review" error={error} retry={retry} /> }
