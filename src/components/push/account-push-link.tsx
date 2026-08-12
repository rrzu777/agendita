import Link from 'next/link'
import { getAppUrl } from '@/lib/business/urls'

export function AccountPushLink() {
  return (
    <Link
      href={getAppUrl('/notificaciones')}
      prefetch={false}
      className="mt-3 inline-block text-sm font-semibold text-pink-700 hover:underline"
    >
      Administrar recordatorios
    </Link>
  )
}
