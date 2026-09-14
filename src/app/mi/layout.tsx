import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { prepareMiUser } from '@/lib/auth/mi-user'
import { PageMessage } from '@/components/ui/page-message'
import { ClientAccountShell } from '@/components/client/client-shell'
import { signOut } from '@/lib/auth/actions'

async function salirAction() {
  'use server'
  await signOut()
}

// Superficie personal: fuera de los índices, como /tarjeta/[token].
export const metadata: Metadata = { title: 'Mi cuenta', robots: { index: false, follow: false } }

export default async function MiLayout({ children }: { children: React.ReactNode }) {
  // Asegura fila User + vincula customers por email (una vez por request). Las
  // pages comparten esta misma llamada cacheada y la await-ean antes de leer.
  const result = await prepareMiUser()
  if (result.status === 'anon') redirect('/ingresar?next=/mi')
  if (result.status === 'conflict') {
    return (
      <ClientAccountShell accountAction={<form action={salirAction}><button type="submit" className="rounded-lg px-3 text-sm font-semibold text-primary hover:bg-secondary">Salir</button></form>}>
        <PageMessage title="No pudimos preparar tu cuenta" message={result.message} />
      </ClientAccountShell>
    )
  }

  return <div data-client-auth-boundary="">{children}</div>
}
