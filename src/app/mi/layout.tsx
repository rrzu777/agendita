import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/user'
import { ensureUserRow, AccountConflictError } from '@/lib/auth/ensure-user-row'
import { isVerifiedEmail, linkCustomersByVerifiedEmail } from '@/lib/customers/link'
import { prisma } from '@/lib/db'
import { signOut } from '@/lib/auth/actions'
import { PageMessage } from '@/components/ui/page-message'

// Superficie personal: fuera de los índices, como /tarjeta/[token].
export const metadata: Metadata = { robots: { index: false, follow: false } }

async function salirAction() {
  'use server'
  await signOut()
}

export default async function MiLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/ingresar?next=/mi')

  try {
    await ensureUserRow(user)
  } catch (e) {
    if (e instanceof AccountConflictError) {
      return <PageMessage title="No pudimos preparar tu cuenta" message={e.message} />
    }
    throw e
  }

  // Vía 1 de vinculación: solo email verificado; idempotente en cada entrada.
  if (user.email && isVerifiedEmail(user)) {
    await linkCustomersByVerifiedEmail(prisma, user.id, user.email)
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
