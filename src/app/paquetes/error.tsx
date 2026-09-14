'use client'
import { ClientRouteError } from '@/components/client/client-route-error'
export default function PackagesError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) { return <ClientRouteError area="packages" error={error} retry={retry} /> }
