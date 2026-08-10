import type { Metadata } from 'next'
import { PushManager } from '@/components/push/push-manager'
import { getAppUrl } from '@/lib/business/urls'

export const metadata: Metadata = {
  title: 'Recordatorios | Agendita',
  description: 'Activá recordatorios para tus próximas citas.',
}

export default function NotificationsPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6 py-12">
      <section className="w-full space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <p className="text-sm font-medium text-primary">Agendita</p>
          <h1 className="text-2xl font-semibold tracking-tight">Recordatorios de citas</h1>
          <p className="text-sm text-muted-foreground">
            El navegador te pedirá permiso sólo cuando pulses el botón.
          </p>
        </div>
        <PushManager
          vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null}
          canonicalOrigin={getAppUrl('')}
        />
      </section>
    </main>
  )
}
