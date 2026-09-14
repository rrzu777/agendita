'use client'
import { PublicRouteError } from '@/components/public/public-route-error'
export default function ErrorPage(props: { error: Error & { digest?: string }; retry: () => void }) { return <PublicRouteError {...props} /> }
