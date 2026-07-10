import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { prepareMiUser } from '@/lib/auth/mi-user'
import { signOut } from '@/lib/auth/actions'
import { PageMessage } from '@/components/ui/page-message'

// Superficie personal: fuera de los índices, como /tarjeta/[token].
export const metadata: Metadata = { robots: { index: false, follow: false } }

async function salirAction() {
  'use server'
  await signOut()
}

export default async function MiLayout({ children }: { children: React.ReactNode }) {
  // Asegura fila User + vincula customers por email (una vez por request). Las
  // pages comparten esta misma llamada cacheada y la await-ean antes de leer.
  const result = await prepareMiUser()
  if (result.status === 'anon') redirect('/ingresar?next=/mi')
  if (result.status === 'conflict') {
    return <PageMessage title="No pudimos preparar tu cuenta" message={result.message} />
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-md items-center justify-between px-4 py-4">
        <span className="font-heading text-lg font-semibold text-primary">Mi cuenta</span>
        <form action={salirAction}>
          <button type="submit" className="text-sm text-muted-foreground hover:underline">Salir</button>
        </form>
      </header>
      {children}
    </div>
  )
}
