'use client'
import { ClientRouteError } from '@/components/client/client-route-error'
export default function LoyaltyError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) { return <ClientRouteError error={error} retry={retry} /> }
