'use client'
import { ClientRouteError } from '@/components/client/client-route-error'
export default function LoyaltyError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) { return <ClientRouteError area="benefits" error={error} retry={retry} /> }
